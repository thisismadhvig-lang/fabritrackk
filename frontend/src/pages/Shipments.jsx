import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { API, api, fmtDate, fmtNum } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Download, RefreshCcw, Eye, FileText } from "lucide-react";
import UniversalPrintButton from "@/components/erp/UniversalPrintButton";

const buildShipmentNo = () => {
  const stamp = new Date();
  const y = stamp.getFullYear();
  const m = String(stamp.getMonth() + 1).padStart(2, "0");
  const d = String(stamp.getDate()).padStart(2, "0");
  const hh = String(stamp.getHours()).padStart(2, "0");
  const mm = String(stamp.getMinutes()).padStart(2, "0");
  return `SH-${y}${m}${d}${hh}${mm}`;
};

const makeEmptyForm = () => ({
  shipment_no: buildShipmentNo(),
  shipment_date: new Date().toISOString().slice(0, 10),
  order_id: "",
  order_number: "",
  customer: "",
  invoice_no: "",
  transport: "",
  vehicle_no: "",
  lr_no: "",
  destination: "",
  driver_name: "",
  e_way_bill: "",
  remarks: "",
  products: [],
});

const normalizeNumber = (value) => Number(value || 0);

export default function Shipments() {
  const [shipments, setShipments] = useState([]);
  const [orders, setOrders] = useState([]);
  const [buyers, setBuyers] = useState([]);
  const [warehouseItems, setWarehouseItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(makeEmptyForm());
  const [selectedPrintIds, setSelectedPrintIds] = useState([]);

  const loadOrders = useCallback(async () => {
    try {
      const response = await api.get("/orders", { params: { include_archived: true } });
      setOrders(response.data || []);
    } catch (error) {
      console.error(error);
    }
  }, []);

  const loadBuyers = useCallback(async () => {
    try {
      const response = await api.get("/buyers", { params: { include_archived: true } });
      setBuyers(response.data || []);
    } catch (error) {
      console.error(error);
    }
  }, []);

  const loadWarehouse = useCallback(async () => {
    try {
      const response = await api.get("/warehouse");
      setWarehouseItems(response.data?.items || []);
    } catch (error) {
      console.error(error);
    }
  }, []);

  const loadShipments = useCallback(async (query = "") => {
    setLoading(true);
    try {
      const response = await api.get("/shipments", { params: { search: query || undefined } });
      setShipments(response.data || []);
    } catch (error) {
      console.error(error);
      setShipments([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    loadOrders();
    loadBuyers();
    loadWarehouse();
    loadShipments(search);
  }, [loadOrders, loadBuyers, loadWarehouse, loadShipments, search]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      loadShipments(search);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [loadShipments, search]);

  const selectedOrder = useMemo(() => {
    return orders.find((order) => order.id === form.order_id || order.order_number === form.order_number) || null;
  }, [orders, form.order_id, form.order_number]);

  const buyerName = useMemo(() => {
    const buyerId = selectedOrder?.buyer_id;
    return buyers.find((buyer) => buyer.id === buyerId)?.name || "";
  }, [buyers, selectedOrder]);

  const orderLines = useMemo(() => {
    if (!selectedOrder) return [];
    return (selectedOrder.items || []).map((item) => {
      const warehouseMatch = warehouseItems.find((entry) => {
        const articleMatch = Boolean(item.article_number && entry.article_number && entry.article_number.toLowerCase() === item.article_number.toLowerCase());
        const brandMatch = Boolean(item.brand && entry.brand && entry.brand.toLowerCase() === item.brand.toLowerCase());
        const productTypeMatch = Boolean(selectedOrder.product_type_id && entry.product_type_id && entry.product_type_id === selectedOrder.product_type_id);
        return articleMatch || (brandMatch && productTypeMatch) || (!item.article_number && productTypeMatch);
      });

      const availablePieces = normalizeNumber(warehouseMatch?.pieces_available ?? warehouseMatch?.pieces_received ?? 0);
      return {
        order_id: selectedOrder.id,
        order_number: selectedOrder.order_number,
        article_number: item.article_number || "",
        brand: item.brand || "",
        product_name: item.product_type || item.description || selectedOrder.order_number,
        product_type_id: selectedOrder.product_type_id || "",
        product_type_name: item.product_type || item.description || "",
        color: item.color || "",
        size: item.size || "",
        available_pieces: availablePieces,
        dispatch_quantity: "",
        unit: "pcs",
      };
    });
  }, [selectedOrder, warehouseItems]);

  useEffect(() => {
    if (!selectedOrder) {
      setForm((prev) => ({ ...prev, customer: prev.customer || "", products: [] }));
      return;
    }

    setForm((prev) => ({
      ...prev,
      order_id: selectedOrder.id,
      order_number: selectedOrder.order_number,
      customer: prev.customer || buyerName || "",
      products: orderLines.map((line) => ({
        ...line,
        dispatch_quantity: prev.products.find((existing) => existing.article_number === line.article_number)?.dispatch_quantity || "",
      })),
    }));
  }, [selectedOrder, buyerName, orderLines]);

  const selectedOrderSummary = useMemo(() => {
    if (!selectedOrder) {
      return {
        buyerName: "",
        orderDate: "",
        deliveryDate: "",
        orderType: "",
        totalOrdered: 0,
        alreadyShipped: 0,
        pendingShipment: 0,
      };
    }

    const alreadyShipped = shipments
      .filter((shipment) => shipment.order_id === selectedOrder.id || shipment.order_number === selectedOrder.order_number)
      .reduce((sum, shipment) => sum + normalizeNumber(shipment.total_dispatch_qty || 0), 0);

    return {
      buyerName: buyerName || "",
      orderDate: selectedOrder.order_date || "",
      deliveryDate: selectedOrder.delivery_date || "",
      orderType: selectedOrder.order_type || "",
      totalOrdered: normalizeNumber(selectedOrder.total_pieces || selectedOrder.quantity || 0),
      alreadyShipped,
      pendingShipment: Math.max(normalizeNumber(selectedOrder.total_pieces || selectedOrder.quantity || 0) - alreadyShipped, 0),
    };
  }, [selectedOrder, buyerName, shipments]);

  const lineSummary = useMemo(() => {
    const products = form.products || [];
    const totalDispatchQty = products.reduce((sum, row) => sum + normalizeNumber(row.dispatch_quantity || 0), 0);
    const totalWarehouseBalance = products.reduce((sum, row) => sum + Math.max(normalizeNumber(row.available_pieces || 0) - normalizeNumber(row.dispatch_quantity || 0), 0), 0);

    return {
      totalProducts: products.length,
      totalDispatchQty,
      totalPendingQty: Math.max(selectedOrderSummary.pendingShipment - totalDispatchQty, 0),
      totalWarehouseBalance,
    };
  }, [form.products, selectedOrderSummary.pendingShipment]);

  const updateOrderSelection = (value) => {
    const selected = orders.find((order) => order.id === value || order.order_number === value) || null;
    setForm((prev) => ({
      ...prev,
      order_id: selected?.id || "",
      order_number: selected?.order_number || value,
      customer: prev.customer || buyerName || "",
      products: [],
    }));
  };

  const updateLineField = (index, field, value) => {
    setForm((prev) => ({
      ...prev,
      products: prev.products.map((row, rowIndex) => {
        if (rowIndex !== index) return row;
        if (field === "dispatch_quantity") {
          return { ...row, dispatch_quantity: value };
        }
        return { ...row, [field]: value };
      }),
    }));
  };

  const submit = async (event) => {
    event.preventDefault();
    const shipmentNo = (form.shipment_no || "").trim() || buildShipmentNo();
    const activeLines = (form.products || []).filter((row) => normalizeNumber(row.dispatch_quantity || 0) > 0);

    if (!form.order_id && !form.order_number) {
      return toast.error("Select an order number before creating a shipment");
    }
    if (!shipmentNo) {
      return toast.error("Shipment number is required");
    }
    if (activeLines.length === 0) {
      return toast.error("Enter at least one dispatch quantity");
    }

    for (const line of activeLines) {
      const available = normalizeNumber(line.available_pieces || 0);
      const requested = normalizeNumber(line.dispatch_quantity || 0);
      if (requested > available) {
        return toast.error(`Dispatch quantity cannot exceed warehouse availability for ${line.article_number || line.product_name || "the selected line"}`);
      }
    }

    setSubmitting(true);
    try {
      await api.post("/shipments", {
        ...form,
        shipment_no: shipmentNo,
        order_id: form.order_id,
        order_number: form.order_number,
        customer: form.customer || buyerName || "",
        products: activeLines.map((line) => ({
          ...line,
          available_pieces: normalizeNumber(line.available_pieces || 0),
          dispatch_quantity: normalizeNumber(line.dispatch_quantity || 0),
        })),
      });
      toast.success("Shipment saved and warehouse stock updated");
      setForm(makeEmptyForm());
      loadShipments(search);
      loadWarehouse();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Shipment could not be created");
    } finally {
      setSubmitting(false);
    }
  };

  const exportShipments = () => {
    const params = search ? `?search=${encodeURIComponent(search)}` : "";
    window.open(`${API}/export/shipments${params}`, "_blank");
  };

  return (
    <div data-testid="shipments-page" className="space-y-4">
      <PageHeader
        title="Shipment Module"
        subtitle="Create shipments from warehouse stock and link them to an existing order"
        testid="shipments-header"
        actions={
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => loadShipments(search)} className="gap-2">
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </Button>
            <Button type="button" variant="outline" onClick={exportShipments} className="gap-2">
              <Download className="h-4 w-4" />
              Export
            </Button>
            <UniversalPrintButton
              moduleName="Shipment"
              rows={shipments}
              columns={[
                { key: "shipment_no", label: "Shipment #" },
                { key: "customer", label: "Customer" },
                { key: "shipment_date", label: "Date" },
                { key: "status", label: "Status" },
              ]}
              summary={[{ label: "Total Shipments", value: shipments.length }]}
              reportTitle="Shipment Register"
              reportPeriod={search || "All Shipments"}
              selectedRows={shipments.filter((shipment) => selectedPrintIds.includes(shipment.id))}
              filteredRows={shipments}
              allRows={shipments}
              selectedIds={selectedPrintIds}
              onSelectedIdsChange={setSelectedPrintIds}
            />
          </div>
        }
      />

      <Card className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-900">New Shipment</div>
            <div className="text-sm text-slate-500">Warehouse stock is the source of inventory and the selected order is the commercial reference.</div>
          </div>
          <Badge className="bg-emerald-100 text-emerald-700">Warehouse → Order linked dispatch</Badge>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <Label>Shipment Number</Label>
              <Input value={form.shipment_no} readOnly className="bg-slate-50" />
            </div>
            <div>
              <Label>Shipment Date</Label>
              <Input type="date" value={form.shipment_date} onChange={(event) => setForm((prev) => ({ ...prev, shipment_date: event.target.value }))} />
            </div>
            <div>
              <Label>Order Number</Label>
              <Select value={form.order_id || form.order_number || ""} onValueChange={updateOrderSelection}>
                <SelectTrigger>
                  <SelectValue placeholder="Select order" />
                </SelectTrigger>
                <SelectContent>
                  {orders.map((order) => (
                    <SelectItem key={order.id} value={order.id}>
                      {order.order_number}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Customer</Label>
              <Input value={form.customer} onChange={(event) => setForm((prev) => ({ ...prev, customer: event.target.value }))} placeholder="Customer name" />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <Label>Invoice Number</Label>
              <Input value={form.invoice_no} onChange={(event) => setForm((prev) => ({ ...prev, invoice_no: event.target.value }))} placeholder="INV-101" />
            </div>
            <div>
              <Label>Transport</Label>
              <Input value={form.transport} onChange={(event) => setForm((prev) => ({ ...prev, transport: event.target.value }))} placeholder="Road / Air" />
            </div>
            <div>
              <Label>Vehicle Number</Label>
              <Input value={form.vehicle_no} onChange={(event) => setForm((prev) => ({ ...prev, vehicle_no: event.target.value }))} placeholder="MH-12-AB-1234" />
            </div>
            <div>
              <Label>LR Number</Label>
              <Input value={form.lr_no} onChange={(event) => setForm((prev) => ({ ...prev, lr_no: event.target.value }))} placeholder="LR-101" />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <Label>Destination</Label>
              <Input value={form.destination} onChange={(event) => setForm((prev) => ({ ...prev, destination: event.target.value }))} placeholder="Delhi" />
            </div>
            <div>
              <Label>Driver Name</Label>
              <Input value={form.driver_name} onChange={(event) => setForm((prev) => ({ ...prev, driver_name: event.target.value }))} placeholder="Driver name" />
            </div>
            <div>
              <Label>E-Way Bill Number</Label>
              <Input value={form.e_way_bill} onChange={(event) => setForm((prev) => ({ ...prev, e_way_bill: event.target.value }))} placeholder="Optional" />
            </div>
            <div>
              <Label>Remarks</Label>
              <Textarea value={form.remarks} onChange={(event) => setForm((prev) => ({ ...prev, remarks: event.target.value }))} rows={2} placeholder="Notes" />
            </div>
          </div>

          <Card className="rounded-[16px] border border-slate-200 bg-slate-50 p-4">
            <div className="mb-3 text-sm font-semibold text-slate-900">Order Information</div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Buyer Name</div>
                <div className="mt-1 text-sm font-medium text-slate-900">{selectedOrderSummary.buyerName || "—"}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Order Date</div>
                <div className="mt-1 text-sm font-medium text-slate-900">{selectedOrderSummary.orderDate ? fmtDate(selectedOrderSummary.orderDate) : "—"}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Delivery Date</div>
                <div className="mt-1 text-sm font-medium text-slate-900">{selectedOrderSummary.deliveryDate ? fmtDate(selectedOrderSummary.deliveryDate) : "—"}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Order Type</div>
                <div className="mt-1 text-sm font-medium text-slate-900">{selectedOrderSummary.orderType || "—"}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Total Ordered Pieces</div>
                <div className="mt-1 text-sm font-medium text-slate-900">{fmtNum(selectedOrderSummary.totalOrdered)}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Pending Shipment</div>
                <div className="mt-1 text-sm font-medium text-slate-900">{fmtNum(selectedOrderSummary.pendingShipment)}</div>
              </div>
            </div>
          </Card>

          <Card className="rounded-[16px] border border-slate-200 bg-white p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">Shipment Items</div>
                <div className="text-sm text-slate-500">Warehouse availability drives each dispatch row.</div>
              </div>
              <Badge className="bg-slate-100 text-slate-700">{selectedOrder ? `Order ${selectedOrder.order_number}` : "Select an order"}</Badge>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full border-separate border-spacing-0 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  <tr>
                    <th className="border-b border-slate-200 px-3 py-3">Article Number</th>
                    <th className="border-b border-slate-200 px-3 py-3">Product</th>
                    <th className="border-b border-slate-200 px-3 py-3">Brand</th>
                    <th className="border-b border-slate-200 px-3 py-3">Colour</th>
                    <th className="border-b border-slate-200 px-3 py-3">Size</th>
                    <th className="border-b border-slate-200 px-3 py-3">Warehouse Available Qty</th>
                    <th className="border-b border-slate-200 px-3 py-3">Dispatch Qty</th>
                    <th className="border-b border-slate-200 px-3 py-3">Balance After Shipment</th>
                  </tr>
                </thead>
                <tbody>
                  {form.products.length === 0 ? (
                    <tr>
                      <td colSpan="8" className="px-3 py-6 text-center text-sm text-slate-500">Select an order to load dispatch lines.</td>
                    </tr>
                  ) : (
                    form.products.map((row, index) => {
                      const balance = Math.max(normalizeNumber(row.available_pieces || 0) - normalizeNumber(row.dispatch_quantity || 0), 0);
                      return (
                        <tr key={`${row.article_number || index}-${index}`} className="odd:bg-white even:bg-slate-50/70">
                          <td className="px-3 py-3 font-medium text-slate-900">{row.article_number || "—"}</td>
                          <td className="px-3 py-3 text-slate-700">{row.product_name || "—"}</td>
                          <td className="px-3 py-3 text-slate-700">{row.brand || "—"}</td>
                          <td className="px-3 py-3 text-slate-700">{row.color || "—"}</td>
                          <td className="px-3 py-3 text-slate-700">{row.size || "—"}</td>
                          <td className="px-3 py-3 text-slate-700">{fmtNum(row.available_pieces || 0)}</td>
                          <td className="px-3 py-3">
                            <Input type="number" min="0" value={row.dispatch_quantity || ""} onChange={(event) => updateLineField(index, "dispatch_quantity", event.target.value)} className="max-w-[120px]" />
                          </td>
                          <td className="px-3 py-3 text-slate-700">{fmtNum(balance)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="rounded-[16px] border border-slate-200 bg-slate-50 p-4">
            <div className="grid gap-4 md:grid-cols-4">
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Total Products</div>
                <div className="mt-1 text-lg font-semibold text-slate-900">{lineSummary.totalProducts}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Total Dispatch Qty</div>
                <div className="mt-1 text-lg font-semibold text-slate-900">{fmtNum(lineSummary.totalDispatchQty)}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Total Pending Qty</div>
                <div className="mt-1 text-lg font-semibold text-slate-900">{fmtNum(lineSummary.totalPendingQty)}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Total Warehouse Balance After Shipment</div>
                <div className="mt-1 text-lg font-semibold text-slate-900">{fmtNum(lineSummary.totalWarehouseBalance)}</div>
              </div>
            </div>
          </Card>

          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-slate-500">Shipment creation will deduct warehouse stock and keep the order linked as the commercial reference.</div>
            <Button type="submit" className="bg-slate-900 hover:bg-slate-800" disabled={submitting}>
              {submitting ? "Saving..." : "Create Shipment"}
            </Button>
          </div>
        </form>
      </Card>

      <Card className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-900">Shipment History</div>
            <div className="text-sm text-slate-500">All shipment activity is kept in one register for review and printing.</div>
          </div>
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search shipment or customer" className="pl-9" />
          </div>
        </div>

        {loading ? (
          <div className="px-3 py-8 text-center text-sm text-slate-500">Loading shipments…</div>
        ) : shipments.length === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-slate-500">No shipments yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                <tr>
                  <th className="border-b border-slate-200 px-3 py-3">Shipment #</th>
                  <th className="border-b border-slate-200 px-3 py-3">Date</th>
                  <th className="border-b border-slate-200 px-3 py-3">Order #</th>
                  <th className="border-b border-slate-200 px-3 py-3">Customer</th>
                  <th className="border-b border-slate-200 px-3 py-3">Total Qty</th>
                  <th className="border-b border-slate-200 px-3 py-3">Status</th>
                  <th className="border-b border-slate-200 px-3 py-3">Print</th>
                  <th className="border-b border-slate-200 px-3 py-3">View</th>
                </tr>
              </thead>
              <tbody>
                {shipments.map((shipment) => (
                  <tr key={shipment.id} className="odd:bg-white even:bg-slate-50/70">
                    <td className="px-3 py-3 font-semibold text-slate-900">{shipment.shipment_no || "—"}</td>
                    <td className="px-3 py-3 text-slate-700">{fmtDate(shipment.shipment_date)}</td>
                    <td className="px-3 py-3 text-slate-700">{shipment.order_number || "—"}</td>
                    <td className="px-3 py-3 text-slate-700">{shipment.customer || "—"}</td>
                    <td className="px-3 py-3 text-slate-700">{fmtNum(shipment.total_dispatch_qty || 0)}</td>
                    <td className="px-3 py-3">
                      <Badge className="bg-slate-100 text-slate-700">{shipment.status || "Completed"}</Badge>
                    </td>
                    <td className="px-3 py-3">
                      <Button type="button" variant="outline" size="sm" className="gap-2">
                        <FileText className="h-4 w-4" />
                        Print
                      </Button>
                    </td>
                    <td className="px-3 py-3">
                      <Button type="button" variant="outline" size="sm" className="gap-2">
                        <Eye className="h-4 w-4" />
                        View
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
