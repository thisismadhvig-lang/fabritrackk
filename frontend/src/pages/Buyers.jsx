import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, fmtDate } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Archive, ArchiveRestore } from "lucide-react";

const empty = { name: "", contact: "", country: "", type: "local" };

export default function Buyers() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);
  const [showArchived, setShowArchived] = useState(false);

  const load = async () => setItems((await api.get("/buyers", { params: { include_archived: showArchived } })).data);
  useEffect(() => { load(); }, [showArchived]);

  const openNew = () => { setEditing(null); setForm(empty); setOpen(true); };
  const openEdit = (row) => {
    setEditing(row);
    setForm({ name: row.name, contact: row.contact || "", country: row.country || "", type: row.type });
    setOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name) return toast.error("Name required");
    try {
      if (editing) {
        await api.patch(`/buyers/${editing.id}`, form);
        toast.success("Buyer updated");
      } else {
        await api.post("/buyers", form);
        toast.success("Buyer added");
      }
      setForm(empty); setEditing(null); setOpen(false); load();
    } catch (err) { toast.error(err.response?.data?.detail || "Failed"); }
  };

  const toggleArchive = async (row) => {
    const to = !row.archived;
    if (!window.confirm(to ? "Archive this buyer?" : "Restore this buyer?")) return;
    await api.patch(`/buyers/${row.id}/archive`, { archived: to });
    toast.success(to ? "Archived" : "Restored"); load();
  };

  return (
    <div data-testid="buyers-page">
      <PageHeader
        title="Buyers"
        subtitle="Local wholesale and export customers"
        actions={
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <Switch data-testid="show-archived-toggle" checked={showArchived} onCheckedChange={setShowArchived} />
              Show archived
            </label>
            <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setEditing(null); setForm(empty); } }}>
              <DialogTrigger asChild>
                <Button data-testid="add-buyer-btn" onClick={openNew} className="bg-slate-900 hover:bg-slate-800">
                  <Plus className="h-4 w-4 mr-2" /> New Buyer
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader><DialogTitle className="font-heading">{editing ? "Edit Buyer" : "New Buyer"}</DialogTitle></DialogHeader>
                <form onSubmit={submit} className="space-y-3">
                  <div><Label>Name *</Label>
                    <Input data-testid="buyer-name-input" value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                  <div><Label>Contact</Label>
                    <Input data-testid="buyer-contact-input" value={form.contact}
                      onChange={(e) => setForm({ ...form, contact: e.target.value })} placeholder="Phone / Email" /></div>
                  <div><Label>Country</Label>
                    <Input data-testid="buyer-country-input" value={form.country}
                      onChange={(e) => setForm({ ...form, country: e.target.value })} /></div>
                  <div><Label>Type</Label>
                    <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                      <SelectTrigger data-testid="buyer-type-select"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="local">Local Wholesale</SelectItem>
                        <SelectItem value="export">Export</SelectItem>
                      </SelectContent>
                    </Select></div>
                  <Button data-testid="buyer-submit-btn" type="submit" className="w-full bg-slate-900 hover:bg-slate-800">
                    {editing ? "Save Changes" : "Add Buyer"}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      <Card className="rounded-md shadow-sm border border-slate-200 bg-white overflow-hidden">
        <Table data-testid="buyers-table">
          <TableHeader>
            <TableRow className="bg-slate-50">
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Country</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Added</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-slate-400 py-8">No buyers yet</TableCell></TableRow>
            )}
            {items.map((b) => (
              <TableRow key={b.id} className={b.archived ? "opacity-50" : ""} data-testid={`buyer-row-${b.id}`}>
                <TableCell className="font-medium">{b.name}</TableCell>
                <TableCell>
                  <Badge className={b.type === "export" ? "bg-purple-100 text-purple-700 hover:bg-purple-100" : "bg-slate-100 text-slate-700 hover:bg-slate-100"}>
                    {b.type}
                  </Badge>
                </TableCell>
                <TableCell>{b.country || "—"}</TableCell>
                <TableCell>{b.contact || "—"}</TableCell>
                <TableCell>{fmtDate(b.created_at)}</TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    <Button data-testid={`edit-buyer-${b.id}`} variant="ghost" size="icon" onClick={() => openEdit(b)}>
                      <Pencil className="h-4 w-4 text-slate-600" />
                    </Button>
                    <Button data-testid={`archive-buyer-${b.id}`} variant="ghost" size="icon" onClick={() => toggleArchive(b)}>
                      {b.archived ? <ArchiveRestore className="h-4 w-4 text-emerald-600" /> : <Archive className="h-4 w-4 text-amber-600" />}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
