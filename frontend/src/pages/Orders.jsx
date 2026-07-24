import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, fmtDate, fmtNum, STAGE_LABEL } from "@/lib/api";
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
import CsvImportButton from "@/components/CsvImportButton";

const empty = { order_number: "", buyer_id: "", product_type_id: "", quantity: "", unit_price: "", delivery_date: "", notes: "" };

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [buyers, setBuyers] = useState([]);
  const [products, setProducts] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);
  const [showArchived, setShowArchived] = useState(false);

  const load = async () => {
    const [o, b, p] = await Promise.all([
      api.get("/orders", { params: { include_archived: showArchived } }),
      api.get("/buyers", { params: { include_archived: true } }),
      api.get("/product-types", { params: { include_archived: true } }),
    ]);
    setOrders(o.data); setBuyers(b.data); setProducts(p.data);
  };
  useEffect(() => { load(); }, [showArchived]);

  const openNew = () => { setEditing(null); setForm(empty); setOpen(true); };
  const openEdit = (row) => {
    setEditing(row);
    setForm({
      order_number: row.order_number,
      buyer_id: row.buyer_id,
      product_type_id: row.product_type_id,
      quantity: String(row.quantity),
      unit_price: String(row.unit_price || 0),
      delivery_date: row.delivery_date ? row.delivery_date.slice(0, 10) : "",
      notes: row.notes || "",
    });
    setOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.order_number || !form.buyer_id || !form.product_type_id || !form.quantity) {
      return toast.error("Order number, buyer, product & qty required");
    }
    const payload = {
      ...form,
      quantity: parseInt(form.quantity),
      unit_price: parseFloat(form.unit_price || 0),
      delivery_date: form.delivery_date || null,
    };
    try {
      if (editing) {
        await api.patch(`/orders/${editing.id}`, payload);
        toast.success("Order updated");
      } else {
        await api.post("/orders", payload);
        toast.success("Order created");
      }
      setForm(empty); setEditing(null); setOpen(false); load();
    } catch (err) { toast.error(err.response?.data?.detail || "Failed"); }
  };

  const toggleArchive = async (row) => {
    const to = !row.archived;
    if (!window.confirm(to ? "Archive this order?" : "Restore this order?")) return;
    await api.patch(`/orders/${row.id}/archive`, { archived: to });
    toast.success(to ? "Archived" : "Restored"); load();
  };

  const bMap = Object.fromEntries(buyers.map(b => [b.id, b]));
  const pMap = Object.fromEntries(products.map(p => [p.id, p]));

  return (
    <div data-testid="orders-page">
      <PageHeader
        title="Orders & Buyers"
        subtitle="Wholesale local and export orders across all buyers"
        actions={
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <Switch data-testid="show-archived-toggle" checked={showArchived} onCheckedChange={setShowArchived} />
              Show archived
            </label>
            <CsvImportButton
              endpoint="/import/orders"
              label="Import Orders"
              columns={["order_number", "buyer_name", "product_name", "quantity", "unit_price", "delivery_date", "notes"]}
              sampleFilename="orders_sample.csv"
              testid="orders-csv-import"
              onDone={load}
            />
            <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setEditing(null); setForm(empty); } }}>
              <DialogTrigger asChild>
                <Button data-testid="add-order-btn" onClick={openNew} className="bg-slate-900 hover:bg-slate-800">
                  <Plus className="h-4 w-4 mr-2" /> New Order
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg">
                <DialogHeader><DialogTitle className="font-heading">{editing ? "Edit Order" : "New Order"}</DialogTitle></DialogHeader>
                <form onSubmit={submit} className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Order Number *</Label>
                      <Input data-testid="order-number-input" value={form.order_number}
                        onChange={(e) => setForm({ ...form, order_number: e.target.value })}
                        placeholder="e.g. ORD-2025-001" />
                    </div>
                    <div>
                      <Label>Quantity *</Label>
                      <Input data-testid="order-qty-input" type="number" value={form.quantity}
                        onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
                    </div>
                  </div>
                  <div>
                    <Label>Unit Price (₹ per piece)</Label>
                    <Input data-testid="order-price-input" type="number" step="0.01" value={form.unit_price}
                      onChange={(e) => setForm({ ...form, unit_price: e.target.value })}
                      placeholder="0.00 (used for revenue KPIs)" />
                  </div>
                  <div>
                    <Label>Buyer *</Label>
                    <Select value={form.buyer_id} onValueChange={(v) => setForm({ ...form, buyer_id: v })}>
                      <SelectTrigger data-testid="order-buyer-select"><SelectValue placeholder="Select buyer" /></SelectTrigger>
                      <SelectContent>
                        {buyers.map((b) => (<SelectItem key={b.id} value={b.id}>{b.name} ({b.type})</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Product Type *</Label>
                    <Select value={form.product_type_id} onValueChange={(v) => setForm({ ...form, product_type_id: v })}>
                      <SelectTrigger data-testid="order-product-select"><SelectValue placeholder="Select product" /></SelectTrigger>
                      <SelectContent>
                        {products.map((p) => (<SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Delivery Date</Label>
                    <Input data-testid="order-delivery-input" type="date" value={form.delivery_date}
                      onChange={(e) => setForm({ ...form, delivery_date: e.target.value })} />
                  </div>
                  <div>
                    <Label>Notes</Label>
                    <Textarea data-testid="order-notes-input" value={form.notes}
                      onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                  </div>
                  <Button data-testid="order-submit-btn" type="submit" className="w-full bg-slate-900 hover:bg-slate-800">
                    {editing ? "Save Changes" : "Create Order"}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      <Card className="rounded-md shadow-sm border border-slate-200 bg-white overflow-hidden">
        <Table data-testid="orders-table">
          <TableHeader>
            <TableRow className="bg-slate-50">
              <TableHead>Order #</TableHead>
              <TableHead>Buyer</TableHead>
              <TableHead>Product</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead>Order Date</TableHead>
              <TableHead>Delivery</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.length === 0 && (
              <TableRow><TableCell colSpan={9} className="text-center text-slate-400 py-8">No orders yet</TableCell></TableRow>
            )}
            {orders.map((o) => (
              <TableRow key={o.id} className={o.archived ? "opacity-50" : ""} data-testid={`order-row-${o.id}`}>
                <TableCell className="font-medium">{o.order_number}</TableCell>
                <TableCell>
                  {bMap[o.buyer_id] ? (
                    <div className="flex items-center gap-1.5">
                      {bMap[o.buyer_id].name}
                      <Badge className={bMap[o.buyer_id].type === "export" ? "bg-purple-100 text-purple-700" : "bg-slate-100 text-slate-700"}>
                        {bMap[o.buyer_id].type}
                      </Badge>
                    </div>
                  ) : "—"}
                </TableCell>
                <TableCell>{pMap[o.product_type_id]?.name || "—"}</TableCell>
                <TableCell className="text-right font-mono-plex">{fmtNum(o.quantity)}</TableCell>
                <TableCell className="text-right font-mono-plex">₹{o.unit_price || 0}</TableCell>
                <TableCell><Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">{STAGE_LABEL[o.stage]}</Badge></TableCell>
                <TableCell>{fmtDate(o.order_date)}</TableCell>
                <TableCell>{fmtDate(o.delivery_date)}</TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    <Button data-testid={`edit-order-${o.id}`} variant="ghost" size="icon" onClick={() => openEdit(o)}>
                      <Pencil className="h-4 w-4 text-slate-600" />
                    </Button>
                    <Button data-testid={`archive-order-${o.id}`} variant="ghost" size="icon" onClick={() => toggleArchive(o)}>
                      {o.archived ? <ArchiveRestore className="h-4 w-4 text-emerald-600" /> : <Archive className="h-4 w-4 text-amber-600" />}
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
