import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, fmtKg, fmtDate } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Pencil, Archive, ArchiveRestore } from "lucide-react";
import CsvImportButton from "@/components/CsvImportButton";

const empty = { fabric_type: "", color: "", supplier: "", kg_received: "", cost_per_kg: "", notes: "" };

export default function FabricInventory() {
  const [lots, setLots] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);
  const [showArchived, setShowArchived] = useState(false);

  const load = async () => {
    const res = await api.get("/fabric-lots", { params: { include_archived: showArchived } });
    setLots(res.data);
  };

  useEffect(() => { load(); }, [showArchived]);

  const openNew = () => { setEditing(null); setForm(empty); setOpen(true); };
  const openEdit = (row) => {
    setEditing(row);
    setForm({
      fabric_type: row.fabric_type,
      color: row.color || "",
      supplier: row.supplier || "",
      kg_received: String(row.kg_received),
      cost_per_kg: String(row.cost_per_kg || 0),
      notes: row.notes || "",
    });
    setOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.fabric_type || !form.kg_received) return toast.error("Fabric type and kg received are required");
    const payload = {
      ...form,
      kg_received: parseFloat(form.kg_received),
      cost_per_kg: parseFloat(form.cost_per_kg || 0),
    };
    try {
      if (editing) {
        await api.patch(`/fabric-lots/${editing.id}`, payload);
        toast.success("Fabric lot updated");
      } else {
        await api.post("/fabric-lots", payload);
        toast.success("Fabric lot added");
      }
      setForm(empty); setEditing(null); setOpen(false); load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed");
    }
  };

  const toggleArchive = async (row) => {
    const to = !row.archived;
    if (!window.confirm(to ? "Archive this fabric lot?" : "Restore this lot?")) return;
    await api.patch(`/fabric-lots/${row.id}/archive`, { archived: to });
    toast.success(to ? "Archived" : "Restored");
    load();
  };

  return (
    <div data-testid="fabric-inventory-page">
      <PageHeader
        title="Fabric Inventory"
        subtitle="Track incoming fabric lots and remaining stock in kg"
        actions={
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <Switch data-testid="show-archived-toggle" checked={showArchived} onCheckedChange={setShowArchived} />
              Show archived
            </label>
            <CsvImportButton
              endpoint="/import/fabric-lots"
              label="Import Fabric Lots"
              columns={["fabric_type", "color", "supplier", "kg_received", "cost_per_kg", "date_received", "notes"]}
              sampleFilename="fabric_lots_sample.csv"
              testid="fabric-csv-import"
              onDone={load}
            />
            <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setEditing(null); setForm(empty); } }}>
              <DialogTrigger asChild>
                <Button data-testid="add-fabric-btn" onClick={openNew} className="bg-slate-900 hover:bg-slate-800">
                  <Plus className="h-4 w-4 mr-2" /> Add Fabric Lot
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg">
                <DialogHeader><DialogTitle className="font-heading">{editing ? "Edit Fabric Lot" : "New Fabric Lot"}</DialogTitle></DialogHeader>
                <form onSubmit={submit} className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Fabric Type *</Label>
                      <Input data-testid="fabric-type-input" value={form.fabric_type}
                        onChange={(e) => setForm({ ...form, fabric_type: e.target.value })} placeholder="e.g. Cotton" />
                    </div>
                    <div>
                      <Label>Color</Label>
                      <Input data-testid="fabric-color-input" value={form.color}
                        onChange={(e) => setForm({ ...form, color: e.target.value })} />
                    </div>
                    <div>
                      <Label>Kg Received *</Label>
                      <Input data-testid="fabric-kg-input" type="number" step="0.01" value={form.kg_received}
                        onChange={(e) => setForm({ ...form, kg_received: e.target.value })} />
                    </div>
                    <div>
                      <Label>Cost per Kg</Label>
                      <Input data-testid="fabric-cost-input" type="number" step="0.01" value={form.cost_per_kg}
                        onChange={(e) => setForm({ ...form, cost_per_kg: e.target.value })} />
                    </div>
                    <div className="col-span-2">
                      <Label>Supplier</Label>
                      <Input data-testid="fabric-supplier-input" value={form.supplier}
                        onChange={(e) => setForm({ ...form, supplier: e.target.value })} />
                    </div>
                    <div className="col-span-2">
                      <Label>Notes</Label>
                      <Textarea data-testid="fabric-notes-input" value={form.notes}
                        onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                    </div>
                  </div>
                  <Button data-testid="fabric-submit-btn" type="submit" className="w-full bg-slate-900 hover:bg-slate-800">
                    {editing ? "Save Changes" : "Add Fabric Lot"}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      <Card className="rounded-md shadow-sm border border-slate-200 bg-white overflow-hidden">
        <Table data-testid="fabric-lots-table">
          <TableHeader>
            <TableRow className="bg-slate-50">
              <TableHead>Fabric Type</TableHead>
              <TableHead>Color</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead className="text-right">Received</TableHead>
              <TableHead className="text-right">Dispatched</TableHead>
              <TableHead className="text-right">Remaining</TableHead>
              <TableHead>Date</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lots.length === 0 && (
              <TableRow><TableCell colSpan={8} className="text-center text-slate-400 py-8">No fabric lots yet</TableCell></TableRow>
            )}
            {lots.map((l) => {
              const low = l.kg_remaining <= 0.001;
              return (
                <TableRow key={l.id} className={l.archived ? "opacity-50" : ""} data-testid={`fabric-row-${l.id}`}>
                  <TableCell className="font-medium">{l.fabric_type}</TableCell>
                  <TableCell>{l.color || "—"}</TableCell>
                  <TableCell>{l.supplier || "—"}</TableCell>
                  <TableCell className="text-right font-mono-plex">{fmtKg(l.kg_received)}</TableCell>
                  <TableCell className="text-right font-mono-plex text-blue-700">{fmtKg(l.kg_dispatched)}</TableCell>
                  <TableCell className="text-right font-mono-plex">
                    <Badge className={low ? "bg-red-100 text-red-700 hover:bg-red-100" : "bg-emerald-100 text-emerald-700 hover:bg-emerald-100"}>
                      {fmtKg(l.kg_remaining)}
                    </Badge>
                  </TableCell>
                  <TableCell>{fmtDate(l.date_received)}</TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button data-testid={`edit-fabric-${l.id}`} variant="ghost" size="icon" onClick={() => openEdit(l)}>
                        <Pencil className="h-4 w-4 text-slate-600" />
                      </Button>
                      <Button data-testid={`archive-fabric-${l.id}`} variant="ghost" size="icon" onClick={() => toggleArchive(l)}>
                        {l.archived ? <ArchiveRestore className="h-4 w-4 text-emerald-600" /> : <Archive className="h-4 w-4 text-amber-600" />}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
