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

const empty = { name: "", type: "third_party", contact: "", location: "" };

export default function Vendors() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);
  const [showArchived, setShowArchived] = useState(false);

  const load = async () => setItems((await api.get("/vendors", { params: { include_archived: showArchived } })).data);
  useEffect(() => { load(); }, [showArchived]);

  const openNew = () => { setEditing(null); setForm(empty); setOpen(true); };
  const openEdit = (row) => {
    setEditing(row);
    setForm({ name: row.name, type: row.type, contact: row.contact || "", location: row.location || "" });
    setOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name) return toast.error("Name required");
    try {
      if (editing) {
        await api.patch(`/vendors/${editing.id}`, form);
        toast.success("Vendor updated");
      } else {
        await api.post("/vendors", form);
        toast.success("Vendor added");
      }
      setForm(empty); setEditing(null); setOpen(false); load();
    } catch (err) { toast.error(err.response?.data?.detail || "Failed"); }
  };

  const toggleArchive = async (row) => {
    const to = !row.archived;
    if (!window.confirm(to ? "Archive this vendor?" : "Restore this vendor?")) return;
    await api.patch(`/vendors/${row.id}/archive`, { archived: to });
    toast.success(to ? "Archived" : "Restored"); load();
  };

  return (
    <div data-testid="vendors-page">
      <PageHeader
        title="Vendors & Units"
        subtitle="Own factory units and third-party manufacturers"
        actions={
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <Switch data-testid="show-archived-toggle" checked={showArchived} onCheckedChange={setShowArchived} />
              Show archived
            </label>
            <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setEditing(null); setForm(empty); } }}>
              <DialogTrigger asChild>
                <Button data-testid="add-vendor-btn" onClick={openNew} className="bg-slate-900 hover:bg-slate-800">
                  <Plus className="h-4 w-4 mr-2" /> New Vendor
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader><DialogTitle className="font-heading">{editing ? "Edit Vendor" : "New Vendor"}</DialogTitle></DialogHeader>
                <form onSubmit={submit} className="space-y-3">
                  <div><Label>Name *</Label>
                    <Input data-testid="vendor-name-input" value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                  <div><Label>Type</Label>
                    <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                      <SelectTrigger data-testid="vendor-type-select"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="own">Own Factory</SelectItem>
                        <SelectItem value="third_party">Third Party</SelectItem>
                      </SelectContent>
                    </Select></div>
                  <div><Label>Contact</Label>
                    <Input data-testid="vendor-contact-input" value={form.contact}
                      onChange={(e) => setForm({ ...form, contact: e.target.value })} /></div>
                  <div><Label>Location</Label>
                    <Input data-testid="vendor-location-input" value={form.location}
                      onChange={(e) => setForm({ ...form, location: e.target.value })} /></div>
                  <Button data-testid="vendor-submit-btn" type="submit" className="w-full bg-slate-900 hover:bg-slate-800">
                    {editing ? "Save Changes" : "Add Vendor"}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      <Card className="rounded-md shadow-sm border border-slate-200 bg-white overflow-hidden">
        <Table data-testid="vendors-table">
          <TableHeader>
            <TableRow className="bg-slate-50">
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Added</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-slate-400 py-8">No vendors yet</TableCell></TableRow>
            )}
            {items.map((v) => (
              <TableRow key={v.id} className={v.archived ? "opacity-50" : ""} data-testid={`vendor-row-${v.id}`}>
                <TableCell className="font-medium">{v.name}</TableCell>
                <TableCell>
                  <Badge className={v.type === "own" ? "bg-blue-100 text-blue-700 hover:bg-blue-100" : "bg-amber-100 text-amber-700 hover:bg-amber-100"}>
                    {v.type === "own" ? "Own" : "3rd Party"}
                  </Badge>
                </TableCell>
                <TableCell>{v.location || "—"}</TableCell>
                <TableCell>{v.contact || "—"}</TableCell>
                <TableCell>{fmtDate(v.created_at)}</TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    <Button data-testid={`edit-vendor-${v.id}`} variant="ghost" size="icon" onClick={() => openEdit(v)}>
                      <Pencil className="h-4 w-4 text-slate-600" />
                    </Button>
                    <Button data-testid={`archive-vendor-${v.id}`} variant="ghost" size="icon" onClick={() => toggleArchive(v)}>
                      {v.archived ? <ArchiveRestore className="h-4 w-4 text-emerald-600" /> : <Archive className="h-4 w-4 text-amber-600" />}
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
