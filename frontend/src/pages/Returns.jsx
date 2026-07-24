import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, fmtDate, fmtKg, fmtNum } from "@/lib/api";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Archive, ArchiveRestore } from "lucide-react";

const empty = { vendor_id: "", order_id: "", product_type_id: "", pieces_received: "", pieces_defected: "0", kg_used: "", fabric_returned_kg: "0", cutting_waste_kg: "0", job_work_rate_per_piece: "0", notes: "" };

export default function Returns() {
  const [items, setItems] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);
  const [showArchived, setShowArchived] = useState(false);

  const load = async () => {
    const [r, v, o, p] = await Promise.all([
      api.get("/production-returns", { params: { include_archived: showArchived } }),
      api.get("/vendors", { params: { include_archived: true } }),
      api.get("/orders", { params: { include_archived: true } }),
      api.get("/product-types", { params: { include_archived: true } }),
    ]);
    setItems(r.data); setVendors(v.data); setOrders(o.data); setProducts(p.data);
  };
  useEffect(() => { load(); }, [showArchived]);

  const openNew = () => { setEditing(null); setForm(empty); setOpen(true); };
  const openEdit = (row) => {
    setEditing(row);
    setForm({
      vendor_id: row.vendor_id,
      order_id: row.order_id || "",
      product_type_id: row.product_type_id,
      pieces_received: String(row.pieces_received),
      pieces_defected: String(row.pieces_defected),
      kg_used: String(row.kg_used),
      fabric_returned_kg: String(row.fabric_returned_kg || 0),
      cutting_waste_kg: String(row.cutting_waste_kg || 0),
      job_work_rate_per_piece: String(row.job_work_rate_per_piece || 0),
      notes: row.notes || "",
    });
    setOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.vendor_id || !form.product_type_id || !form.pieces_received) {
      return toast.error("Vendor, product and pieces received are required");
    }
    const payload = {
      ...form,
      order_id: form.order_id || null,
      pieces_received: parseInt(form.pieces_received),
      pieces_defected: parseInt(form.pieces_defected || 0),
      kg_used: parseFloat(form.kg_used || 0),
      fabric_returned_kg: parseFloat(form.fabric_returned_kg || 0),
      cutting_waste_kg: parseFloat(form.cutting_waste_kg || 0),
      job_work_rate_per_piece: parseFloat(form.job_work_rate_per_piece || 0),
    };
    try {
      if (editing) {
        await api.patch(`/production-returns/${editing.id}`, payload);
        toast.success("Return updated");
      } else {
        await api.post("/production-returns", payload);
        toast.success("Return recorded");
      }
      setForm(empty); setEditing(null); setOpen(false); load();
    } catch (err) { toast.error(err.response?.data?.detail || "Failed"); }
  };

  const toggleArchive = async (row) => {
    const to = !row.archived;
    if (!window.confirm(to ? "Archive this return?" : "Restore this return?")) return;
    await api.patch(`/production-returns/${row.id}/archive`, { archived: to });
    toast.success(to ? "Archived" : "Restored"); load();
  };

  const vMap = Object.fromEntries(vendors.map(v => [v.id, v]));
  const pMap = Object.fromEntries(products.map(p => [p.id, p]));
  const oMap = Object.fromEntries(orders.map(o => [o.id, o]));

  return (
    <div data-testid="returns-page">
      <PageHeader
        title="Returns & Quality Check"
        subtitle="Record finished pieces coming back from manufacturing units"
        actions={
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <Switch data-testid="show-archived-toggle" checked={showArchived} onCheckedChange={setShowArchived} />
              Show archived
            </label>
            <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setEditing(null); setForm(empty); } }}>
              <DialogTrigger asChild>
                <Button data-testid="add-return-btn" onClick={openNew} className="bg-slate-900 hover:bg-slate-800">
                  <Plus className="h-4 w-4 mr-2" /> Record Return
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg">
                <DialogHeader><DialogTitle className="font-heading">{editing ? "Edit Production Return" : "New Production Return"}</DialogTitle></DialogHeader>
                <form onSubmit={submit} className="space-y-3">
                  <div>
                    <Label>Vendor / Unit *</Label>
                    <Select value={form.vendor_id} onValueChange={(v) => setForm({ ...form, vendor_id: v })}>
                      <SelectTrigger data-testid="return-vendor-select"><SelectValue placeholder="Select vendor" /></SelectTrigger>
                      <SelectContent>
                        {vendors.map((v) => (<SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Product Type *</Label>
                    <Select value={form.product_type_id} onValueChange={(v) => setForm({ ...form, product_type_id: v })}>
                      <SelectTrigger data-testid="return-product-select"><SelectValue placeholder="Select product" /></SelectTrigger>
                      <SelectContent>
                        {products.map((p) => (<SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Link to Order (optional)</Label>
                    <Select value={form.order_id || "none"} onValueChange={(v) => setForm({ ...form, order_id: v === "none" ? "" : v })}>
                      <SelectTrigger data-testid="return-order-select"><SelectValue placeholder="No order linked" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— None —</SelectItem>
                        {orders.map((o) => (<SelectItem key={o.id} value={o.id}>{o.order_number}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label>Pieces Received *</Label>
                      <Input data-testid="return-pieces-input" type="number" value={form.pieces_received}
                        onChange={(e) => setForm({ ...form, pieces_received: e.target.value })} />
                    </div>
                    <div>
                      <Label>Defected</Label>
                      <Input data-testid="return-defected-input" type="number" value={form.pieces_defected}
                        onChange={(e) => setForm({ ...form, pieces_defected: e.target.value })} />
                    </div>
                    <div>
                      <Label>Kg Used</Label>
                      <Input data-testid="return-kg-input" type="number" step="0.01" value={form.kg_used}
                        onChange={(e) => setForm({ ...form, kg_used: e.target.value })} />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label>Fabric Returned (kg)</Label>
                      <Input data-testid="return-fabricret-input" type="number" step="0.01" value={form.fabric_returned_kg}
                        onChange={(e) => setForm({ ...form, fabric_returned_kg: e.target.value })} />
                    </div>
                    <div>
                      <Label>Cutting Waste (kg)</Label>
                      <Input data-testid="return-waste-input" type="number" step="0.01" value={form.cutting_waste_kg}
                        onChange={(e) => setForm({ ...form, cutting_waste_kg: e.target.value })} />
                    </div>
                    <div>
                      <Label>Job Work ₹/pc</Label>
                      <Input data-testid="return-rate-input" type="number" step="0.01" value={form.job_work_rate_per_piece}
                        onChange={(e) => setForm({ ...form, job_work_rate_per_piece: e.target.value })} />
                    </div>
                  </div>
                  <div>
                    <Label>Notes</Label>
                    <Textarea data-testid="return-notes-input" value={form.notes}
                      onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                  </div>
                  <Button data-testid="return-submit-btn" type="submit" className="w-full bg-slate-900 hover:bg-slate-800">
                    {editing ? "Save Changes" : "Save"}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      <Card className="rounded-md shadow-sm border border-slate-200 bg-white overflow-hidden">
        <Table data-testid="returns-table">
          <TableHeader>
            <TableRow className="bg-slate-50">
              <TableHead>Date</TableHead>
              <TableHead>Vendor</TableHead>
              <TableHead>Product</TableHead>
              <TableHead>Order</TableHead>
              <TableHead className="text-right">Received</TableHead>
              <TableHead className="text-right">Good</TableHead>
              <TableHead className="text-right">Defected</TableHead>
              <TableHead className="text-right">Kg Used</TableHead>
              <TableHead className="text-right">Avg kg/pc</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && (
              <TableRow><TableCell colSpan={10} className="text-center text-slate-400 py-8">No returns yet</TableCell></TableRow>
            )}
            {items.map((r) => {
              const good = r.pieces_received - r.pieces_defected;
              const avg = r.pieces_received ? (r.kg_used / r.pieces_received).toFixed(3) : "—";
              return (
                <TableRow key={r.id} className={r.archived ? "opacity-50" : ""} data-testid={`return-row-${r.id}`}>
                  <TableCell>{fmtDate(r.date)}</TableCell>
                  <TableCell className="font-medium">{vMap[r.vendor_id]?.name || "—"}</TableCell>
                  <TableCell>{pMap[r.product_type_id]?.name || "—"}</TableCell>
                  <TableCell>{oMap[r.order_id]?.order_number || "—"}</TableCell>
                  <TableCell className="text-right font-mono-plex">{fmtNum(r.pieces_received)}</TableCell>
                  <TableCell className="text-right"><Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">{fmtNum(good)}</Badge></TableCell>
                  <TableCell className="text-right">
                    <Badge className={r.pieces_defected > 0 ? "bg-red-100 text-red-700 hover:bg-red-100" : "bg-slate-100 text-slate-500 hover:bg-slate-100"}>
                      {fmtNum(r.pieces_defected)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono-plex">{fmtKg(r.kg_used)}</TableCell>
                  <TableCell className="text-right font-mono-plex">{avg}</TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button data-testid={`edit-return-${r.id}`} variant="ghost" size="icon" onClick={() => openEdit(r)}>
                        <Pencil className="h-4 w-4 text-slate-600" />
                      </Button>
                      <Button data-testid={`archive-return-${r.id}`} variant="ghost" size="icon" onClick={() => toggleArchive(r)}>
                        {r.archived ? <ArchiveRestore className="h-4 w-4 text-emerald-600" /> : <Archive className="h-4 w-4 text-amber-600" />}
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
