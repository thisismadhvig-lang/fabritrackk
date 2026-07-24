import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api, fmtKg, fmtDate } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Archive, ArchiveRestore } from "lucide-react";
import { Switch } from "@/components/ui/switch";

const empty = { fabric_lot_id: "", vendor_id: "", order_id: "", product_type_id: "", kg_dispatched: "", notes: "" };

export default function FabricDispatchPage() {
  const [items, setItems] = useState([]);
  const [lots, setLots] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);
  const [showArchived, setShowArchived] = useState(false);

  const load = async () => {
    const [d, l, v, o, p] = await Promise.all([
      api.get("/fabric-dispatches", { params: { include_archived: showArchived } }),
      api.get("/fabric-lots", { params: { include_archived: true } }),
      api.get("/vendors", { params: { include_archived: true } }),
      api.get("/orders", { params: { include_archived: true } }),
      api.get("/product-types", { params: { include_archived: true } }),
    ]);
    setItems(d.data);
    setLots(l.data);
    setVendors(v.data);
    setOrders(o.data);
    setProducts(p.data);
  };

  useEffect(() => { load(); }, [showArchived]);

  const openNew = () => {
    setEditing(null);
    setForm(empty);
    setOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setForm({
      fabric_lot_id: row.fabric_lot_id,
      vendor_id: row.vendor_id,
      order_id: row.order_id || "",
      product_type_id: row.product_type_id || "",
      kg_dispatched: String(row.kg_dispatched),
      notes: row.notes || "",
    });
    setOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.fabric_lot_id || !form.vendor_id || !form.kg_dispatched) {
      toast.error("Fabric lot, vendor and kg are required");
      return;
    }
    const payload = {
      ...form,
      order_id: form.order_id || null,
      product_type_id: form.product_type_id || null,
      kg_dispatched: parseFloat(form.kg_dispatched),
    };
    try {
      if (editing) {
        await api.patch(`/fabric-dispatches/${editing.id}`, payload);
        toast.success("Dispatch updated");
      } else {
        await api.post("/fabric-dispatches", payload);
        toast.success("Fabric dispatched");
      }
      setForm(empty);
      setEditing(null);
      setOpen(false);
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed");
    }
  };

  const toggleArchive = async (row) => {
    const to = !row.archived;
    if (!window.confirm(to ? "Archive this dispatch?" : "Restore this dispatch?")) return;
    await api.patch(`/fabric-dispatches/${row.id}/archive`, { archived: to });
    toast.success(to ? "Archived" : "Restored");
    load();
  };

  const lotMap = useMemo(() => Object.fromEntries(lots.map(l => [l.id, l])), [lots]);
  const vendorMap = useMemo(() => Object.fromEntries(vendors.map(v => [v.id, v])), [vendors]);
  const orderMap = useMemo(() => Object.fromEntries(orders.map(o => [o.id, o])), [orders]);
  const productMap = useMemo(() => Object.fromEntries(products.map(p => [p.id, p])), [products]);

  const availableLots = useMemo(
    () => lots.filter(l => editing?.fabric_lot_id === l.id || l.kg_remaining > 0.001),
    [lots, editing]
  );

  return (
    <div data-testid="dispatch-page">
      <PageHeader
        title="Fabric Dispatch"
        subtitle="Send fabric to own factory or third-party manufacturers"
        actions={
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <Switch data-testid="show-archived-toggle" checked={showArchived} onCheckedChange={setShowArchived} />
              Show archived
            </label>
            <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setEditing(null); setForm(empty); } }}>
              <DialogTrigger asChild>
                <Button data-testid="add-dispatch-btn" onClick={openNew} className="bg-slate-900 hover:bg-slate-800">
                  <Plus className="h-4 w-4 mr-2" /> New Dispatch
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle className="font-heading">{editing ? "Edit Dispatch" : "Dispatch Fabric"}</DialogTitle>
                </DialogHeader>
                <form onSubmit={submit} className="space-y-3">
                  <div>
                    <Label>Fabric Lot *</Label>
                    <Select value={form.fabric_lot_id} onValueChange={(v) => setForm({ ...form, fabric_lot_id: v })}>
                      <SelectTrigger data-testid="dispatch-lot-select"><SelectValue placeholder="Select fabric lot" /></SelectTrigger>
                      <SelectContent>
                        {availableLots.map((l) => (
                          <SelectItem key={l.id} value={l.id}>
                            {l.fabric_type} · {l.color || "—"} · {fmtKg(l.kg_remaining ?? l.kg_received)} left
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Vendor / Unit *</Label>
                    <Select value={form.vendor_id} onValueChange={(v) => setForm({ ...form, vendor_id: v })}>
                      <SelectTrigger data-testid="dispatch-vendor-select"><SelectValue placeholder="Select vendor" /></SelectTrigger>
                      <SelectContent>
                        {vendors.map((v) => (
                          <SelectItem key={v.id} value={v.id}>
                            {v.name} ({v.type === "own" ? "Own" : "3rd Party"})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Product Type (what will be made)</Label>
                    <Select value={form.product_type_id || "none"} onValueChange={(v) => setForm({ ...form, product_type_id: v === "none" ? "" : v })}>
                      <SelectTrigger data-testid="dispatch-product-select"><SelectValue placeholder="No product linked" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— None —</SelectItem>
                        {products.map((p) => (
                          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Kg Dispatched *</Label>
                    <Input data-testid="dispatch-kg-input" type="number" step="0.01" value={form.kg_dispatched}
                      onChange={(e) => setForm({ ...form, kg_dispatched: e.target.value })} />
                  </div>
                  <div>
                    <Label>Link to Order (optional)</Label>
                    <Select value={form.order_id || "none"} onValueChange={(v) => setForm({ ...form, order_id: v === "none" ? "" : v })}>
                      <SelectTrigger data-testid="dispatch-order-select"><SelectValue placeholder="No order linked" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— None —</SelectItem>
                        {orders.map((o) => (
                          <SelectItem key={o.id} value={o.id}>{o.order_number} · qty {o.quantity}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Notes</Label>
                    <Textarea data-testid="dispatch-notes-input" value={form.notes}
                      onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                  </div>
                  <Button data-testid="dispatch-submit-btn" type="submit" className="w-full bg-slate-900 hover:bg-slate-800">
                    {editing ? "Save Changes" : "Dispatch"}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      <Card className="rounded-md shadow-sm border border-slate-200 bg-white overflow-hidden">
        <Table data-testid="dispatch-table">
          <TableHeader>
            <TableRow className="bg-slate-50">
              <TableHead>Date</TableHead>
              <TableHead>Fabric</TableHead>
              <TableHead>Vendor</TableHead>
              <TableHead>Product</TableHead>
              <TableHead>Order</TableHead>
              <TableHead className="text-right">Kg</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center text-slate-400 py-8">No dispatches yet</TableCell></TableRow>
            )}
            {items.map((d) => {
              const lot = lotMap[d.fabric_lot_id];
              const ven = vendorMap[d.vendor_id];
              const ord = d.order_id ? orderMap[d.order_id] : null;
              const prod = d.product_type_id ? productMap[d.product_type_id] : null;
              return (
                <TableRow key={d.id} className={d.archived ? "opacity-50" : ""} data-testid={`dispatch-row-${d.id}`}>
                  <TableCell>{fmtDate(d.date)}</TableCell>
                  <TableCell className="font-medium">{lot ? `${lot.fabric_type} · ${lot.color || "—"}` : "—"}</TableCell>
                  <TableCell>
                    {ven ? (
                      <div className="flex items-center gap-2">
                        {ven.name}
                        <Badge className={ven.type === "own" ? "bg-blue-100 text-blue-700 hover:bg-blue-100" : "bg-amber-100 text-amber-700 hover:bg-amber-100"}>
                          {ven.type === "own" ? "Own" : "3rd Party"}
                        </Badge>
                      </div>
                    ) : "—"}
                  </TableCell>
                  <TableCell>{prod ? <Badge className="bg-indigo-100 text-indigo-700 hover:bg-indigo-100">{prod.name}</Badge> : "—"}</TableCell>
                  <TableCell>{ord ? ord.order_number : "—"}</TableCell>
                  <TableCell className="text-right font-mono-plex">{fmtKg(d.kg_dispatched)}</TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button data-testid={`edit-dispatch-${d.id}`} variant="ghost" size="icon" onClick={() => openEdit(d)}>
                        <Pencil className="h-4 w-4 text-slate-600" />
                      </Button>
                      <Button data-testid={`archive-dispatch-${d.id}`} variant="ghost" size="icon" onClick={() => toggleArchive(d)}>
                        {d.archived ? <ArchiveRestore className="h-4 w-4 text-emerald-600" /> : <Archive className="h-4 w-4 text-amber-600" />}
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
