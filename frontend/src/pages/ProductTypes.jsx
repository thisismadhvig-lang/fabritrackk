import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, fmtDate } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Pencil, Archive, ArchiveRestore } from "lucide-react";

const empty = { name: "", avg_fabric_per_piece_kg: "0.25", description: "" };

export default function ProductTypes() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);
  const [showArchived, setShowArchived] = useState(false);

  const load = async () => setItems((await api.get("/product-types", { params: { include_archived: showArchived } })).data);
  useEffect(() => { load(); }, [showArchived]);

  const openNew = () => { setEditing(null); setForm(empty); setOpen(true); };
  const openEdit = (row) => {
    setEditing(row);
    setForm({
      name: row.name,
      avg_fabric_per_piece_kg: String(row.avg_fabric_per_piece_kg),
      description: row.description || "",
    });
    setOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name) return toast.error("Name required");
    const payload = {
      ...form,
      avg_fabric_per_piece_kg: parseFloat(form.avg_fabric_per_piece_kg || 0.25),
    };
    try {
      if (editing) {
        await api.patch(`/product-types/${editing.id}`, payload);
        toast.success("Product updated");
      } else {
        await api.post("/product-types", payload);
        toast.success("Product added");
      }
      setForm(empty); setEditing(null); setOpen(false); load();
    } catch (err) { toast.error(err.response?.data?.detail || "Failed"); }
  };

  const toggleArchive = async (row) => {
    const to = !row.archived;
    if (!window.confirm(to ? "Archive this product?" : "Restore this product?")) return;
    await api.patch(`/product-types/${row.id}/archive`, { archived: to });
    toast.success(to ? "Archived" : "Restored"); load();
  };

  return (
    <div data-testid="products-page">
      <PageHeader
        title="Product Types"
        subtitle="Configurable product catalog — T-shirt, Pajama, Nikkar, and more"
        actions={
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <Switch data-testid="show-archived-toggle" checked={showArchived} onCheckedChange={setShowArchived} />
              Show archived
            </label>
            <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setEditing(null); setForm(empty); } }}>
              <DialogTrigger asChild>
                <Button data-testid="add-product-btn" onClick={openNew} className="bg-slate-900 hover:bg-slate-800">
                  <Plus className="h-4 w-4 mr-2" /> New Product Type
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader><DialogTitle className="font-heading">{editing ? "Edit Product Type" : "New Product Type"}</DialogTitle></DialogHeader>
                <form onSubmit={submit} className="space-y-3">
                  <div><Label>Name *</Label>
                    <Input data-testid="product-name-input" value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="e.g. T-shirt, Pajama, Nikkar" /></div>
                  <div><Label>Avg Fabric per Piece (kg)</Label>
                    <Input data-testid="product-avg-input" type="number" step="0.01" value={form.avg_fabric_per_piece_kg}
                      onChange={(e) => setForm({ ...form, avg_fabric_per_piece_kg: e.target.value })} /></div>
                  <div><Label>Description</Label>
                    <Textarea data-testid="product-desc-input" value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
                  <Button data-testid="product-submit-btn" type="submit" className="w-full bg-slate-900 hover:bg-slate-800">
                    {editing ? "Save Changes" : "Add Product"}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      <Card className="rounded-md shadow-sm border border-slate-200 bg-white overflow-hidden">
        <Table data-testid="products-table">
          <TableHeader>
            <TableRow className="bg-slate-50">
              <TableHead>Name</TableHead>
              <TableHead className="text-right">Avg Fabric / Piece</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Added</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center text-slate-400 py-8">No product types yet</TableCell></TableRow>
            )}
            {items.map((p) => (
              <TableRow key={p.id} className={p.archived ? "opacity-50" : ""} data-testid={`product-row-${p.id}`}>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell className="text-right font-mono-plex">{p.avg_fabric_per_piece_kg} kg</TableCell>
                <TableCell className="text-slate-500">{p.description || "—"}</TableCell>
                <TableCell>{fmtDate(p.created_at)}</TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    <Button data-testid={`edit-product-${p.id}`} variant="ghost" size="icon" onClick={() => openEdit(p)}>
                      <Pencil className="h-4 w-4 text-slate-600" />
                    </Button>
                    <Button data-testid={`archive-product-${p.id}`} variant="ghost" size="icon" onClick={() => toggleArchive(p)}>
                      {p.archived ? <ArchiveRestore className="h-4 w-4 text-emerald-600" /> : <Archive className="h-4 w-4 text-amber-600" />}
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
