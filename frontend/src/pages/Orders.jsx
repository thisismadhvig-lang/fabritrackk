import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Archive, ArchiveRestore, ArrowLeft, Copy, FileDown, Plus, Printer, Trash2 } from "lucide-react";
import CsvImportButton from "@/components/CsvImportButton";
import UniversalPrintButton from "@/components/erp/UniversalPrintButton";

const createItem = () => ({
  product_type: "",
  description: "",
  brand: "",
  article_number: "",
  color: "",
  size: "",
  fabric: "",
  gsm: "",
  quantity: 1,
  unit_price: 0,
  amount: 0,
  remarks: "",
});

const createEmptyForm = () => ({
  order_number: "",
  buyer_id: "",
  order_status: "Confirmed",
  order_type: "export",
  payment_terms: "",
  currency: "INR",
  order_date: new Date().toISOString().slice(0, 10),
  delivery_date: "",
  notes: "",
  discount: 0,
  tax: 0,
  items: [createItem()],
});

const deriveTotals = (items, discount, tax) => {
  const subtotal = items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_price || 0), 0);
  const safeDiscount = Number(discount || 0);
  const safeTax = Number(tax || 0);
  return {
    subtotal,
    discount: safeDiscount,
    tax: safeTax,
    grand_total: subtotal + safeTax - safeDiscount,
  };
};

const formatProductCount = (count) => `${count || 0} Product${Number(count || 0) === 1 ? "" : "s"}`;

export default function Orders() {
  const navigate = useNavigate();
  const { orderId } = useParams();
  const [orders, setOrders] = useState([]);
  const [buyers, setBuyers] = useState([]);
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState(createEmptyForm());
  const [selectedPrintIds, setSelectedPrintIds] = useState([]);
  const [editing, setEditing] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [detailOrder, setDetailOrder] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    const [o, b, p] = await Promise.all([
      api.get("/orders", { params: { include_archived: showArchived } }),
      api.get("/buyers", { params: { include_archived: true } }),
      api.get("/product-types", { params: { include_archived: true } }),
    ]);
    setOrders(o.data);
    setBuyers(b.data);
    setProducts(p.data);
  }, [showArchived]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!orderId) {
      setDetailOrder(null);
      return;
    }
    const fetchDetail = async () => {
      try {
        setDetailLoading(true);
        const { data } = await api.get(`/orders/${orderId}`);
        setDetailOrder(data);
      } catch (err) {
        toast.error(err.response?.data?.detail || "Failed to load order");
      } finally {
        setDetailLoading(false);
      }
    };
    fetchDetail();
  }, [orderId]);

  const openNew = () => {
    setEditing(null);
    setForm(createEmptyForm());
    navigate("/orders");
  };

  const openEdit = (row) => {
    setEditing(row);
    setForm({
      order_number: row.order_number || "",
      buyer_id: row.buyer_id || "",
      order_status: row.order_status || "Confirmed",
      order_type: row.order_type || "export",
      payment_terms: row.payment_terms || "",
      currency: row.currency || "INR",
      order_date: row.order_date ? row.order_date.slice(0, 10) : new Date().toISOString().slice(0, 10),
      delivery_date: row.delivery_date ? row.delivery_date.slice(0, 10) : "",
      notes: row.notes || "",
      discount: Number(row.discount || 0),
      tax: Number(row.tax || 0),
      items: (row.items || []).length ? row.items.map((item) => ({ ...item })) : [createItem()],
    });
    if (row?.id) {
      navigate(`/orders/${row.id}`);
    }
  };

  const handleItemChange = (index, field, value) => {
    const nextItems = form.items.map((item, idx) => {
      if (idx !== index) return item;
      const next = { ...item };
      if (field === "quantity" || field === "unit_price") {
        next[field] = Number(value || 0);
      } else {
        next[field] = value;
      }
      return next;
    });
    const totals = deriveTotals(nextItems, form.discount, form.tax);
    setForm((prev) => ({ ...prev, items: nextItems, ...totals }));
  };

  const handleFormChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const addItem = () => {
    const nextItems = [...form.items, createItem()];
    const totals = deriveTotals(nextItems, form.discount, form.tax);
    setForm((prev) => ({ ...prev, items: nextItems, ...totals }));
  };

  const removeItem = (index) => {
    if (form.items.length === 1) return;
    const nextItems = form.items.filter((_, idx) => idx !== index);
    const totals = deriveTotals(nextItems, form.discount, form.tax);
    setForm((prev) => ({ ...prev, items: nextItems, ...totals }));
  };

  const submit = async (e) => {
    e.preventDefault();
    const hasItems = form.items.some((item) => item.product_type?.trim());
    if (!form.order_number || !form.buyer_id || !hasItems) {
      return toast.error("Order number, buyer and at least one product line are required");
    }

    const totals = deriveTotals(form.items, form.discount, form.tax);
    const payload = {
      order_number: form.order_number,
      buyer_id: form.buyer_id,
      product_type_id: form.items[0]?.product_type || null,
      quantity: form.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
      unit_price: form.items[0]?.unit_price || 0,
      stage: "order_received",
      order_status: form.order_status,
      order_type: form.order_type,
      payment_terms: form.payment_terms,
      currency: form.currency,
      subtotal: totals.subtotal,
      discount: Number(form.discount || 0),
      tax: Number(form.tax || 0),
      grand_total: totals.grand_total,
      order_date: form.order_date || null,
      delivery_date: form.delivery_date || null,
      notes: form.notes,
      items: form.items.map((item) => ({
        ...item,
        quantity: Number(item.quantity || 0),
        unit_price: Number(item.unit_price || 0),
        amount: Number(item.quantity || 0) * Number(item.unit_price || 0),
      })),
    };

    try {
      const response = editing
        ? await api.patch(`/orders/${editing.id}`, payload)
        : await api.post("/orders", payload);
      const savedOrderId = response.data?.id || response?.data?.id || editing?.id;
      toast.success(editing ? "Order updated" : "Order created");
      setEditing(null);
      setForm(createEmptyForm());
      await load();
      if (savedOrderId) {
        navigate(`/orders/${savedOrderId}`);
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed");
    }
  };

  const toggleArchive = async (row) => {
    const to = !row.archived;
    if (!window.confirm(to ? "Archive this order?" : "Restore this order?")) return;
    await api.patch(`/orders/${row.id}/archive`, { archived: to });
    toast.success(to ? "Archived" : "Restored");
    load();
    if (detailOrder?.id === row.id) {
      setDetailOrder((prev) => prev ? { ...prev, archived: to } : prev);
    }
  };

  const duplicateOrder = async (row) => {
    const payload = {
      ...row,
      order_number: `${row.order_number || "ORD"}-COPY`,
      buyer_id: row.buyer_id,
      items: (row.items || []).map((item) => ({ ...item })),
      order_status: row.order_status || "Confirmed",
    };
    const response = await api.post("/orders", payload);
    toast.success("Order duplicated");
    await load();
    navigate(`/orders/${response.data.id}`);
  };

  const bMap = Object.fromEntries(buyers.map((b) => [b.id, b]));
  const pMap = Object.fromEntries(products.map((p) => [p.id, p]));

  const summary = useMemo(() => ({
    totalOrders: orders.length,
    totalPieces: orders.reduce((sum, order) => sum + Number(order.total_pieces || order.quantity || 0), 0),
    totalValue: orders.reduce((sum, order) => sum + Number(order.grand_total || order.subtotal || 0), 0),
  }), [orders]);

  const totals = useMemo(() => deriveTotals(form.items, form.discount, form.tax), [form.items, form.discount, form.tax]);

  const detailActions = (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={() => openEdit(detailOrder)} className="border-slate-300">
        Edit Order
      </Button>
      <Button variant="outline" onClick={() => window.print()} className="border-slate-300">
        <Printer className="mr-2 h-4 w-4" /> Print
      </Button>
      <Button variant="outline" onClick={() => toast.success("PDF export is prepared from the print dialog") } className="border-slate-300">
        <FileDown className="mr-2 h-4 w-4" /> Export PDF
      </Button>
      <Button variant="outline" onClick={() => duplicateOrder(detailOrder)} className="border-slate-300">
        <Copy className="mr-2 h-4 w-4" /> Duplicate Order
      </Button>
      <Button variant="outline" onClick={() => toggleArchive(detailOrder)} className="border-slate-300">
        {detailOrder?.archived ? <ArchiveRestore className="mr-2 h-4 w-4" /> : <Archive className="mr-2 h-4 w-4" />} Archive Order
      </Button>
    </div>
  );

  return (
    <div data-testid="orders-page">
      <PageHeader
        title="Orders & Buyers"
        subtitle="Professional multi-line garment order management for local and export production"
        actions={
          <div className="flex flex-wrap items-center gap-3">
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
            <UniversalPrintButton
              moduleName="Orders"
              rows={orders}
              columns={[
                { key: "order_number", label: "Order #" },
                { key: "buyer_name", label: "Buyer" },
                { key: "total_product_types", label: "Product Types" },
                { key: "total_pieces", label: "Pieces" },
                { key: "grand_total", label: "Value" },
              ]}
              summary={[{ label: "Total Orders", value: orders.length }]}
              reportTitle="Orders Register"
              reportPeriod="All Orders"
              selectedRows={orders.filter((order) => selectedPrintIds.includes(order.id))}
              filteredRows={orders}
              allRows={orders}
              selectedIds={selectedPrintIds}
              onSelectedIdsChange={setSelectedPrintIds}
            />
            <Button data-testid="add-order-btn" onClick={openNew} className="bg-slate-900 hover:bg-slate-800">
              <Plus className="mr-2 h-4 w-4" /> New Order
            </Button>
          </div>
        }
      />

      <div className="mb-4 grid gap-4 md:grid-cols-3">
        <Card className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-sm text-slate-500">Total Orders</div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">{summary.totalOrders}</div>
        </Card>
        <Card className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-sm text-slate-500">Total Pieces</div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">{fmtNum(summary.totalPieces)}</div>
        </Card>
        <Card className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-sm text-slate-500">Total Order Value</div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">₹{fmtNum(summary.totalValue)}</div>
        </Card>
      </div>

      {(!orderId || editing) ? (
        <Card className="mb-6 rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">{editing ? "Edit Order" : "Create Order"}</h2>
              <p className="text-sm text-slate-500">Create one order header with unlimited product rows and automatic commercial totals.</p>
            </div>
            {editing ? <Badge className="bg-amber-100 text-amber-700">Editing</Badge> : null}
          </div>
          <form onSubmit={submit} className="space-y-5">
          <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label>Order Number</Label>
                <Input value={form.order_number} onChange={(e) => handleFormChange("order_number", e.target.value)} placeholder="ORD-2026-001" />
              </div>
              <div>
                <Label>Buyer</Label>
                <Select value={form.buyer_id} onValueChange={(value) => handleFormChange("buyer_id", value)}>
                  <SelectTrigger><SelectValue placeholder="Select buyer" /></SelectTrigger>
                  <SelectContent>
                    {buyers.map((buyer) => (<SelectItem key={buyer.id} value={buyer.id}>{buyer.name}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Order Date</Label>
                <Input type="date" value={form.order_date} onChange={(e) => handleFormChange("order_date", e.target.value)} />
              </div>
              <div>
                <Label>Delivery Date</Label>
                <Input type="date" value={form.delivery_date} onChange={(e) => handleFormChange("delivery_date", e.target.value)} />
              </div>
              <div>
                <Label>Status</Label>
                <Select value={form.order_status} onValueChange={(value) => handleFormChange("order_status", value)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Confirmed">Confirmed</SelectItem>
                    <SelectItem value="Pending">Pending</SelectItem>
                    <SelectItem value="In Production">In Production</SelectItem>
                    <SelectItem value="Completed">Completed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Order Type</Label>
                <Select value={form.order_type} onValueChange={(value) => handleFormChange("order_type", value)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="export">Export</SelectItem>
                    <SelectItem value="local">Local</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Payment Terms</Label>
                <Input value={form.payment_terms} onChange={(e) => handleFormChange("payment_terms", e.target.value)} placeholder="30 days" />
              </div>
              <div>
                <Label>Currency</Label>
                <Input value={form.currency} onChange={(e) => handleFormChange("currency", e.target.value)} placeholder="INR" />
              </div>
            </div>
            <Card className="rounded-[20px] border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-semibold text-slate-800">Order Summary</div>
              <div className="mt-3 space-y-2 text-sm text-slate-600">
                <div className="flex justify-between"><span>Buyer</span><span className="font-medium text-slate-900">{bMap[form.buyer_id]?.name || "—"}</span></div>
                <div className="flex justify-between"><span>Status</span><span className="font-medium text-slate-900">{form.order_status}</span></div>
                <div className="flex justify-between"><span>Product Types</span><span className="font-medium text-slate-900">{form.items.filter((item) => item.product_type?.trim()).length}</span></div>
                <div className="flex justify-between"><span>Total Pieces</span><span className="font-medium text-slate-900">{form.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0)}</span></div>
                <div className="flex justify-between"><span>Total Order Value</span><span className="font-medium text-slate-900">₹{fmtNum(totals.grand_total)}</span></div>
                <div className="flex justify-between"><span>Expected Delivery</span><span className="font-medium text-slate-900">{form.delivery_date ? fmtDate(form.delivery_date) : "—"}</span></div>
              </div>
            </Card>
          </div>

          <div>
            <Label>Notes</Label>
            <Textarea value={form.notes} onChange={(e) => handleFormChange("notes", e.target.value)} rows={3} placeholder="Internal notes and production instructions" />
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0 rounded-xl border border-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-3 text-left text-sm font-semibold text-slate-700">Product Type</th>
                  <th className="px-3 py-3 text-left text-sm font-semibold text-slate-700">Description</th>
                  <th className="px-3 py-3 text-left text-sm font-semibold text-slate-700">Brand</th>
                  <th className="px-3 py-3 text-left text-sm font-semibold text-slate-700">Article</th>
                  <th className="px-3 py-3 text-left text-sm font-semibold text-slate-700">Color</th>
                  <th className="px-3 py-3 text-left text-sm font-semibold text-slate-700">Size</th>
                  <th className="px-3 py-3 text-left text-sm font-semibold text-slate-700">Fabric</th>
                  <th className="px-3 py-3 text-left text-sm font-semibold text-slate-700">GSM</th>
                  <th className="px-3 py-3 text-left text-sm font-semibold text-slate-700">Qty</th>
                  <th className="px-3 py-3 text-left text-sm font-semibold text-slate-700">Unit Price</th>
                  <th className="px-3 py-3 text-left text-sm font-semibold text-slate-700">Amount</th>
                  <th className="px-3 py-3 text-left text-sm font-semibold text-slate-700">Remarks</th>
                  <th className="px-3 py-3" />
                </tr>
              </thead>
              <tbody>
                {form.items.map((item, index) => (
                  <tr key={`${item.product_type}-${index}`} className="border-t border-slate-200 bg-white">
                    <td className="px-3 py-2"><Input value={item.product_type} onChange={(e) => handleItemChange(index, "product_type", e.target.value)} placeholder="Formal Shirt" /></td>
                    <td className="px-3 py-2"><Input value={item.description} onChange={(e) => handleItemChange(index, "description", e.target.value)} placeholder="Classic fit" /></td>
                    <td className="px-3 py-2"><Input value={item.brand} onChange={(e) => handleItemChange(index, "brand", e.target.value)} placeholder="Apex" /></td>
                    <td className="px-3 py-2"><Input value={item.article_number} onChange={(e) => handleItemChange(index, "article_number", e.target.value)} placeholder="ART-001" /></td>
                    <td className="px-3 py-2"><Input value={item.color} onChange={(e) => handleItemChange(index, "color", e.target.value)} placeholder="Navy" /></td>
                    <td className="px-3 py-2"><Input value={item.size} onChange={(e) => handleItemChange(index, "size", e.target.value)} placeholder="M" /></td>
                    <td className="px-3 py-2"><Input value={item.fabric} onChange={(e) => handleItemChange(index, "fabric", e.target.value)} placeholder="Cotton" /></td>
                    <td className="px-3 py-2"><Input value={item.gsm} onChange={(e) => handleItemChange(index, "gsm", e.target.value)} placeholder="180" /></td>
                    <td className="px-3 py-2"><Input type="number" value={item.quantity} onChange={(e) => handleItemChange(index, "quantity", e.target.value)} /></td>
                    <td className="px-3 py-2"><Input type="number" step="0.01" value={item.unit_price} onChange={(e) => handleItemChange(index, "unit_price", e.target.value)} /></td>
                    <td className="px-3 py-2 text-sm font-semibold text-slate-900">₹{fmtNum(Number(item.quantity || 0) * Number(item.unit_price || 0))}</td>
                    <td className="px-3 py-2"><Input value={item.remarks} onChange={(e) => handleItemChange(index, "remarks", e.target.value)} placeholder="Notes" /></td>
                    <td className="px-3 py-2"><Button type="button" variant="ghost" size="icon" onClick={() => removeItem(index)}><Trash2 className="h-4 w-4 text-slate-500" /></Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button type="button" variant="outline" onClick={addItem} className="border-slate-300">
              <Plus className="mr-2 h-4 w-4" /> Add Product
            </Button>
            <div className="flex flex-wrap gap-3 text-sm text-slate-600">
              <div>Total Product Types: <span className="font-semibold text-slate-900">{form.items.filter((item) => item.product_type?.trim()).length}</span></div>
              <div>Total Pieces: <span className="font-semibold text-slate-900">{form.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0)}</span></div>
              <div>Subtotal: <span className="font-semibold text-slate-900">₹{fmtNum(totals.subtotal)}</span></div>
              <div>Discount: <span className="font-semibold text-slate-900">₹{fmtNum(totals.discount)}</span></div>
              <div>Tax: <span className="font-semibold text-slate-900">₹{fmtNum(totals.tax)}</span></div>
              <div>Grand Total: <span className="font-semibold text-slate-900">₹{fmtNum(totals.grand_total)}</span></div>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <Label>Discount</Label>
              <Input type="number" step="0.01" value={form.discount} onChange={(e) => handleFormChange("discount", Number(e.target.value || 0))} />
            </div>
            <div>
              <Label>Tax</Label>
              <Input type="number" step="0.01" value={form.tax} onChange={(e) => handleFormChange("tax", Number(e.target.value || 0))} />
            </div>
            <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm text-slate-500">Grand Total</div>
              <div className="mt-1 text-2xl font-semibold text-slate-900">₹{fmtNum(totals.grand_total)}</div>
            </div>
          </div>

            <div className="flex flex-wrap gap-3">
              <Button type="submit" className="bg-slate-900 hover:bg-slate-800">{editing ? "Save Order" : "Create Order"}</Button>
              <Button type="button" variant="outline" onClick={() => { setEditing(null); setForm(createEmptyForm()); if (orderId) navigate("/orders"); }} className="border-slate-300">Reset</Button>
            </div>
          </form>
        </Card>
      ) : null}

      {!orderId ? (
        <>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Recent Orders</h2>
              <p className="text-sm text-slate-500">Each row represents one complete order with all product line items attached beneath it.</p>
            </div>
          </div>

          <Card className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0" data-testid="orders-table">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Order Number</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Buyer</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Total Product Types</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Total Pieces</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Order Value</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Current Stage</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Delivery Date</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Status</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-sm text-slate-400">No orders yet</td></tr>
              )}
              {orders.map((order) => (
                <tr key={order.id} className={`${order.archived ? "opacity-60" : ""} border-t border-slate-200 bg-white`} data-testid={`order-row-${order.id}`}>
                  <td className="px-4 py-3">
                    <button className="text-left font-semibold text-slate-900 hover:text-slate-700" onClick={() => navigate(`/orders/${order.id}`)}>
                      {order.order_number}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">{bMap[order.buyer_id]?.name || "—"}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">{formatProductCount(order.total_product_types || order.items?.length || 0)}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">{fmtNum(order.total_pieces || order.quantity || 0)}</td>
                  <td className="px-4 py-3 text-sm font-semibold text-slate-900">₹{fmtNum(order.grand_total || order.subtotal || 0)}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">{STAGE_LABEL[order.stage]}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">{fmtDate(order.delivery_date)}</td>
                  <td className="px-4 py-3"><Badge className="bg-blue-100 text-blue-700">{order.order_status || "Confirmed"}</Badge></td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <Button variant="ghost" size="icon" onClick={() => navigate(`/orders/${order.id}`)}><ArrowLeft className="h-4 w-4 text-slate-600" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => openEdit(order)}><ArchiveRestore className="h-4 w-4 text-slate-600" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => toggleArchive(order)}>{order.archived ? <ArchiveRestore className="h-4 w-4 text-emerald-600" /> : <Archive className="h-4 w-4 text-amber-600" />}</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
          </Card>
        </>
      ) : null}

      {orderId ? (
        <div className="mt-6">
          {detailLoading ? <Card className="rounded-[24px] border border-slate-200 bg-white p-6">Loading order details…</Card> : detailOrder ? (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold text-slate-900">{detailOrder.order_number}</h2>
                  <p className="text-sm text-slate-500">Complete view for commercial, production, and delivery tracking.</p>
                </div>
                {detailActions}
              </div>
              <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                <Card className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Order Information</div>
                      <div className="mt-2 space-y-2 text-sm text-slate-600">
                        <div className="flex justify-between"><span>Order Number</span><span className="font-semibold text-slate-900">{detailOrder.order_number}</span></div>
                        <div className="flex justify-between"><span>Order Date</span><span className="font-semibold text-slate-900">{fmtDate(detailOrder.order_date)}</span></div>
                        <div className="flex justify-between"><span>Delivery Date</span><span className="font-semibold text-slate-900">{fmtDate(detailOrder.delivery_date)}</span></div>
                        <div className="flex justify-between"><span>Status</span><span className="font-semibold text-slate-900">{detailOrder.order_status}</span></div>
                      </div>
                    </div>
                    <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Buyer Information</div>
                      <div className="mt-2 space-y-2 text-sm text-slate-600">
                        <div className="flex justify-between"><span>Buyer</span><span className="font-semibold text-slate-900">{bMap[detailOrder.buyer_id]?.name || "—"}</span></div>
                        <div className="flex justify-between"><span>Order Type</span><span className="font-semibold text-slate-900">{detailOrder.order_type || "local"}</span></div>
                        <div className="flex justify-between"><span>Payment Terms</span><span className="font-semibold text-slate-900">{detailOrder.payment_terms || "—"}</span></div>
                        <div className="flex justify-between"><span>Currency</span><span className="font-semibold text-slate-900">{detailOrder.currency || "INR"}</span></div>
                      </div>
                    </div>
                  </div>
                </Card>
                <Card className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Commercial Information</div>
                  <div className="mt-3 space-y-2 text-sm text-slate-600">
                    <div className="flex justify-between"><span>Total Product Types</span><span className="font-semibold text-slate-900">{detailOrder.total_product_types || detailOrder.items?.length || 0}</span></div>
                    <div className="flex justify-between"><span>Total Pieces</span><span className="font-semibold text-slate-900">{fmtNum(detailOrder.total_pieces || detailOrder.quantity || 0)}</span></div>
                    <div className="flex justify-between"><span>Subtotal</span><span className="font-semibold text-slate-900">₹{fmtNum(detailOrder.subtotal || 0)}</span></div>
                    <div className="flex justify-between"><span>Discount</span><span className="font-semibold text-slate-900">₹{fmtNum(detailOrder.discount || 0)}</span></div>
                    <div className="flex justify-between"><span>Tax</span><span className="font-semibold text-slate-900">₹{fmtNum(detailOrder.tax || 0)}</span></div>
                    <div className="flex justify-between"><span>Grand Total</span><span className="font-semibold text-slate-900">₹{fmtNum(detailOrder.grand_total || 0)}</span></div>
                  </div>
                </Card>
              </div>

              <Card className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-lg font-semibold text-slate-900">Order Items Table</div>
                  <Badge className="bg-slate-100 text-slate-700">{formatProductCount(detailOrder.total_product_types || detailOrder.items?.length || 0)}</Badge>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full border-separate border-spacing-0">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-sm font-semibold text-slate-700">Product Type</th>
                        <th className="px-3 py-2 text-left text-sm font-semibold text-slate-700">Description</th>
                        <th className="px-3 py-2 text-left text-sm font-semibold text-slate-700">Brand</th>
                        <th className="px-3 py-2 text-left text-sm font-semibold text-slate-700">Article Number</th>
                        <th className="px-3 py-2 text-left text-sm font-semibold text-slate-700">Color</th>
                        <th className="px-3 py-2 text-left text-sm font-semibold text-slate-700">Fabric</th>
                        <th className="px-3 py-2 text-left text-sm font-semibold text-slate-700">Size</th>
                        <th className="px-3 py-2 text-left text-sm font-semibold text-slate-700">Quantity</th>
                        <th className="px-3 py-2 text-left text-sm font-semibold text-slate-700">Unit Price</th>
                        <th className="px-3 py-2 text-left text-sm font-semibold text-slate-700">Amount</th>
                        <th className="px-3 py-2 text-left text-sm font-semibold text-slate-700">Remarks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(detailOrder.items || []).map((item, index) => (
                        <tr key={`${item.product_type}-${index}`} className="border-t border-slate-200 bg-white">
                          <td className="px-3 py-2 text-sm text-slate-700">{item.product_type}</td>
                          <td className="px-3 py-2 text-sm text-slate-700">{item.description}</td>
                          <td className="px-3 py-2 text-sm text-slate-700">{item.brand}</td>
                          <td className="px-3 py-2 text-sm text-slate-700">{item.article_number}</td>
                          <td className="px-3 py-2 text-sm text-slate-700">{item.color}</td>
                          <td className="px-3 py-2 text-sm text-slate-700">{item.fabric}</td>
                          <td className="px-3 py-2 text-sm text-slate-700">{item.size}</td>
                          <td className="px-3 py-2 text-sm text-slate-700">{item.quantity}</td>
                          <td className="px-3 py-2 text-sm text-slate-700">₹{fmtNum(item.unit_price || 0)}</td>
                          <td className="px-3 py-2 text-sm font-semibold text-slate-900">₹{fmtNum(item.amount || 0)}</td>
                          <td className="px-3 py-2 text-sm text-slate-700">{item.remarks}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="text-lg font-semibold text-slate-900">Totals</div>
                <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-4">
                    <div className="text-sm text-slate-500">Total Product Types</div>
                    <div className="mt-1 text-xl font-semibold text-slate-900">{detailOrder.total_product_types || detailOrder.items?.length || 0}</div>
                  </div>
                  <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-4">
                    <div className="text-sm text-slate-500">Total Pieces</div>
                    <div className="mt-1 text-xl font-semibold text-slate-900">{fmtNum(detailOrder.total_pieces || detailOrder.quantity || 0)}</div>
                  </div>
                  <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-4">
                    <div className="text-sm text-slate-500">Subtotal</div>
                    <div className="mt-1 text-xl font-semibold text-slate-900">₹{fmtNum(detailOrder.subtotal || 0)}</div>
                  </div>
                  <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-4">
                    <div className="text-sm text-slate-500">Discount</div>
                    <div className="mt-1 text-xl font-semibold text-slate-900">₹{fmtNum(detailOrder.discount || 0)}</div>
                  </div>
                  <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-4">
                    <div className="text-sm text-slate-500">Tax</div>
                    <div className="mt-1 text-xl font-semibold text-slate-900">₹{fmtNum(detailOrder.tax || 0)}</div>
                  </div>
                  <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-4">
                    <div className="text-sm text-slate-500">Grand Total</div>
                    <div className="mt-1 text-xl font-semibold text-slate-900">₹{fmtNum(detailOrder.grand_total || 0)}</div>
                  </div>
                </div>
              </Card>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="text-lg font-semibold text-slate-900">Notes</div>
                  <p className="mt-2 text-sm text-slate-600">{detailOrder.notes || "No notes attached to this order."}</p>
                </Card>
                <Card className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="text-lg font-semibold text-slate-900">Timeline</div>
                  <div className="mt-2 rounded-[16px] border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                    Order created and ready for downstream fabric dispatch, production tracing, QC, warehouse and shipment workflows.
                  </div>
                </Card>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
