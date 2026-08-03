import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

const VIEW_OPTIONS = [
  { value: "article", label: "Article" },
  { value: "product", label: "Product" },
  { value: "brand", label: "Brand" },
  { value: "material", label: "Material" },
  { value: "order", label: "Order" },
];

function formatDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString();
  } catch (error) {
    return value;
  }
}

function formatNumber(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num.toLocaleString() : "0";
}

export default function ProductionTraceability() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [view, setView] = useState(searchParams.get("view_by") || searchParams.get("view") || "article");
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [vendor, setVendor] = useState("");
  const [supplier, setSupplier] = useState("");
  const [buyer, setBuyer] = useState("");
  const [brand, setBrand] = useState("");
  const [product, setProduct] = useState("");
  const [material, setMaterial] = useState("");
  const [order, setOrder] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const buildTraceabilityParams = useCallback((overrides = {}) => {
    const params = new URLSearchParams();
    params.set("view_by", overrides.view || view);
    if (overrides.search ?? search) params.set("search", overrides.search ?? search);
    if (overrides.vendor ?? vendor) params.set("vendor", overrides.vendor ?? vendor);
    if (overrides.supplier ?? supplier) params.set("supplier", overrides.supplier ?? supplier);
    if (overrides.buyer ?? buyer) params.set("buyer", overrides.buyer ?? buyer);
    if (overrides.brand ?? brand) params.set("brand", overrides.brand ?? brand);
    if (overrides.product ?? product) params.set("product", overrides.product ?? product);
    if (overrides.material ?? material) params.set("material", overrides.material ?? material);
    if (overrides.order ?? order) params.set("order", overrides.order ?? order);
    if (overrides.dateFrom ?? dateFrom) params.set("date_from", overrides.dateFrom ?? dateFrom);
    if (overrides.dateTo ?? dateTo) params.set("date_to", overrides.dateTo ?? dateTo);
    return params;
  }, [view, search, vendor, supplier, buyer, brand, product, material, order, dateFrom, dateTo]);

  const loadTraceability = useCallback(async (overrides = {}) => {
    setLoading(true);
    const params = buildTraceabilityParams(overrides);

    try {
      const response = await api.get(`/production-traceability?${params.toString()}`);
      setData(response.data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, [buildTraceabilityParams]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const params = buildTraceabilityParams();
    const nextQuery = params.toString();
    setSearchParams(nextQuery ? `?${nextQuery}` : "", { replace: true });
    loadTraceability();
  }, [buildTraceabilityParams, loadTraceability, setSearchParams]);

  const summaryCards = useMemo(() => {
    if (!data?.summary) return [];
    return [
      { label: "Fabric Dispatched", value: data.summary.fabric_dispatched ?? data.summary.total_fabric_dispatched ?? 0 },
      { label: "Expected Pieces", value: data.summary.expected_pieces ?? data.summary.total_expected_pieces ?? 0 },
      { label: "Pieces Received", value: data.summary.pieces_received ?? data.summary.total_pieces_received ?? 0 },
      { label: "Pending", value: data.summary.pieces_pending ?? data.summary.total_pending_pieces ?? data.summary.total_pending ?? 0 },
      { label: "Warehouse Stock", value: data.summary.warehouse_stock ?? data.summary.total_shipment ?? 0 },
      { label: "Pieces Shipped", value: data.summary.pieces_shipped ?? data.summary.total_shipment ?? 0 },
    ];
  }, [data]);

  async function handleExport(kind) {
    const params = buildTraceabilityParams();

    if (kind === "excel") {
      window.open(`${api.defaults.baseURL}/production-traceability/export?${params.toString()}`);
    } else if (kind === "pdf") {
      window.print();
    }
  }

  function pushToTarget(type, value, context = {}) {
    const encodedValue = encodeURIComponent(value || "");
    if (type === "article") {
      setView("article");
      setSearch(value || "");
      navigate(`/production-traceability?view_by=article&search=${encodedValue}`);
      return;
    }
    if (type === "product") {
      setView("product");
      setSearch(value || "");
      navigate(`/production-traceability?view_by=product&search=${encodedValue}`);
      return;
    }
    if (type === "brand") {
      setView("brand");
      setSearch(value || "");
      navigate(`/production-traceability?view_by=brand&search=${encodedValue}`);
      return;
    }
    if (type === "material") {
      setView("material");
      setSearch(value || "");
      navigate(`/production-traceability?view_by=material&search=${encodedValue}`);
      return;
    }
    if (type === "order") {
      navigate(`/orders?search=${encodedValue}`);
      return;
    }
    if (type === "dispatch") {
      const dispatchSearch = encodeURIComponent(context.dispatch_no || value || "");
      navigate(`/dispatch?search=${dispatchSearch}`);
      return;
    }
    if (type === "return") {
      const parts = new URLSearchParams();
      if (context.dispatch_no) parts.set("dispatch", context.dispatch_no);
      if (context.challan_no || value) parts.set("challan", context.challan_no || value || "");
      navigate(`/returns?${parts.toString()}`);
      return;
    }
    if (type === "warehouse") {
      const q = new URLSearchParams();
      if (context.brand) q.set("search", context.brand);
      if (context.product_type_name) q.set("search", `${context.brand || ""} ${context.product_type_name || ""}`.trim());
      navigate(`/warehouse${q.toString() ? `?${q.toString()}` : ""}`);
      return;
    }
    if (type === "shipment") {
      const q = new URLSearchParams();
      if (context.product_type_id) q.set("product_type_id", context.product_type_id);
      if (context.product_type_name) q.set("product_type_name", context.product_type_name);
      if (context.brand) q.set("brand", context.brand);
      if (context.article_number) q.set("article", context.article_number);
      if (context.available_pieces != null) q.set("available_pieces", String(context.available_pieces));
      navigate(`/shipments${q.toString() ? `?${q.toString()}` : ""}`);
      return;
    }
    if (type === "vendor") {
      navigate(`/vendors?search=${encodedValue}`);
      return;
    }
    if (type === "supplier") {
      navigate(`/vendors?search=${encodedValue}`);
      return;
    }
    if (type === "buyer") {
      navigate(`/buyers?search=${encodedValue}`);
      return;
    }
    if (type === "invoice") {
      navigate(`/shipments?search=${encodedValue}`);
      return;
    }
    if (type === "payable") {
      navigate(`/payments/payables?search=${encodedValue}`);
      return;
    }
    if (type === "receivable") {
      navigate(`/payments/receivables?search=${encodedValue}`);
      return;
    }
    if (type === "transaction") {
      navigate(`/payments/transactions?search=${encodedValue}`);
      return;
    }
    if (type === "default") {
      navigate("/production-traceability");
    }
  }

  return (
    <div data-testid="production-traceability-page" className="space-y-4">
      <PageHeader
        title="Production Traceability"
        subtitle="Read-only manufacturing traceability across orders, dispatches, returns, warehouse, and shipments"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={loadTraceability} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </Button>
            <Button variant="outline" onClick={() => handleExport("excel")}>Excel</Button>
            <Button variant="outline" onClick={() => handleExport("pdf")}>PDF</Button>
            <Button variant="outline" onClick={() => window.print()}>Print</Button>
          </div>
        }
      />

      <Card className="p-4 rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[1.2fr_0.9fr_0.8fr] xl:grid-cols-[1.4fr_0.8fr_0.8fr_0.8fr]">
          <div>
            <label className="text-xs uppercase tracking-[0.2em] text-slate-500">Global Search</label>
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search article, product, brand, material, order, dispatch, challan..." />
          </div>
          <div>
            <label className="text-xs uppercase tracking-[0.2em] text-slate-500">View By</label>
            <Select value={view} onValueChange={setView}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VIEW_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button onClick={loadTraceability} className="w-full bg-slate-900 hover:bg-slate-800">Apply</Button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <label className="text-xs uppercase tracking-[0.2em] text-slate-500">Vendor</label>
            <Input value={vendor} onChange={(event) => setVendor(event.target.value)} placeholder="Vendor" />
          </div>
          <div>
            <label className="text-xs uppercase tracking-[0.2em] text-slate-500">Supplier</label>
            <Input value={supplier} onChange={(event) => setSupplier(event.target.value)} placeholder="Supplier" />
          </div>
          <div>
            <label className="text-xs uppercase tracking-[0.2em] text-slate-500">Buyer</label>
            <Input value={buyer} onChange={(event) => setBuyer(event.target.value)} placeholder="Buyer" />
          </div>
          <div>
            <label className="text-xs uppercase tracking-[0.2em] text-slate-500">Brand</label>
            <Input value={brand} onChange={(event) => setBrand(event.target.value)} placeholder="Brand" />
          </div>
          <div>
            <label className="text-xs uppercase tracking-[0.2em] text-slate-500">Product</label>
            <Input value={product} onChange={(event) => setProduct(event.target.value)} placeholder="Product" />
          </div>
          <div>
            <label className="text-xs uppercase tracking-[0.2em] text-slate-500">Material</label>
            <Input value={material} onChange={(event) => setMaterial(event.target.value)} placeholder="Material" />
          </div>
          <div>
            <label className="text-xs uppercase tracking-[0.2em] text-slate-500">Order</label>
            <Input value={order} onChange={(event) => setOrder(event.target.value)} placeholder="Order" />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs uppercase tracking-[0.2em] text-slate-500">Date From</label>
              <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
            </div>
            <div className="flex-1">
              <label className="text-xs uppercase tracking-[0.2em] text-slate-500">Date To</label>
              <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        {summaryCards.map((card) => (
          <Card key={card.label} className="p-4 rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-500">{card.label}</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">{formatNumber(card.value)}</div>
          </Card>
        ))}
      </div>

      {!data ? (
        <Card className="p-8 text-center text-slate-500">Loading traceability data…</Card>
      ) : (
        <div className="space-y-4">
          <Card className="p-4 rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
              <button type="button" className="font-semibold text-slate-900 hover:text-slate-700" onClick={() => pushToTarget("default")}>Traceability</button>
              <span>/</span>
              <button type="button" className="font-semibold text-slate-900 hover:text-slate-700" onClick={() => pushToTarget(view === "article" ? "article" : view)}>{view.charAt(0).toUpperCase() + view.slice(1)}</button>
              {data?.article?.article_number ? <><span>/</span><span>{data.article.article_number}</span></> : null}
              {data?.material ? <><span>/</span><span>{data.material}</span></> : null}
              {data?.product?.name ? <><span>/</span><span>{data.product.name}</span></> : null}
              {data?.brand ? <><span>/</span><span>{data.brand}</span></> : null}
              {data?.order?.order_number ? <><span>/</span><span>{data.order.order_number}</span></> : null}
            </div>
          </Card>

          {view === "article" && (
            <div className="space-y-4">
              <Card className="p-4 rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-slate-900">Article Information</h2>
                  <Badge variant="secondary">Read Only</Badge>
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div><div className="text-xs uppercase tracking-[0.2em] text-slate-500">Article Number</div><button type="button" className="font-medium text-slate-900 hover:text-slate-700" onClick={() => pushToTarget("article", data.article?.article_number)}>{data.article?.article_number || "—"}</button></div>
                  <div><div className="text-xs uppercase tracking-[0.2em] text-slate-500">Product Name</div><button type="button" className="font-medium text-slate-900 hover:text-slate-700" onClick={() => pushToTarget("product", data.article?.product_name)}>{data.article?.product_name || "—"}</button></div>
                  <div><div className="text-xs uppercase tracking-[0.2em] text-slate-500">Brand</div><button type="button" className="font-medium text-slate-900 hover:text-slate-700" onClick={() => pushToTarget("brand", data.article?.brand)}>{data.article?.brand || "—"}</button></div>
                  <div><div className="text-xs uppercase tracking-[0.2em] text-slate-500">Buyer</div><button type="button" className="font-medium text-slate-900 hover:text-slate-700" onClick={() => pushToTarget("buyer")}>{data.article?.buyer || "—"}</button></div>
                  <div><div className="text-xs uppercase tracking-[0.2em] text-slate-500">Order Number</div><button type="button" className="font-medium text-slate-900 hover:text-slate-700" onClick={() => pushToTarget("order", data.article?.order_number)}>{data.article?.order_number || "—"}</button></div>
                  <div><div className="text-xs uppercase tracking-[0.2em] text-slate-500">Order Quantity</div><span className="font-medium text-slate-900">{formatNumber(data.article?.order_quantity)}</span></div>
                </div>
              </Card>

              <Card className="p-4 rounded-xl border border-slate-200 bg-white shadow-sm">
                <h2 className="mb-3 text-lg font-semibold text-slate-900">Fabric Dispatch to Vendors</h2>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Dispatch No.</TableHead>
                      <TableHead>Dispatch Date</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Fabric</TableHead>
                      <TableHead>Quantity</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead>Rolls</TableHead>
                      <TableHead>Expected Pieces</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data.dispatches || []).length === 0 ? (<TableRow><TableCell colSpan={8} className="py-6 text-center text-slate-500">No fabric dispatches found.</TableCell></TableRow>) : (data.dispatches || []).map((item) => (
                      <TableRow key={item.id}>
                        <TableCell><button type="button" className="font-medium text-slate-900 hover:text-slate-700" onClick={() => pushToTarget("dispatch", item.dispatch_no, item)}>{item.dispatch_no}</button></TableCell>
                        <TableCell>{formatDate(item.date)}</TableCell>
                        <TableCell><button type="button" className="font-medium text-slate-900 hover:text-slate-700" onClick={() => pushToTarget("vendor", item.vendor_name)}>{item.vendor_name || "—"}</button></TableCell>
                        <TableCell>{item.fabric_name || "—"}</TableCell>
                        <TableCell>{formatNumber(item.quantity)}</TableCell>
                        <TableCell>{item.unit || "—"}</TableCell>
                        <TableCell>{formatNumber(item.rolls)}</TableCell>
                        <TableCell>{formatNumber(item.expected_pieces)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>

              <Card className="p-4 rounded-xl border border-slate-200 bg-white shadow-sm">
                <h2 className="mb-3 text-lg font-semibold text-slate-900">Returns & QC</h2>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Challan No.</TableHead>
                      <TableHead>Dispatch No.</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Pieces Received</TableHead>
                      <TableHead>Pieces Left</TableHead>
                      <TableHead>Pieces Defected</TableHead>
                      <TableHead>Job Work Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data.returns || []).length === 0 ? (<TableRow><TableCell colSpan={8} className="py-6 text-center text-slate-500">No returns records found.</TableCell></TableRow>) : (data.returns || []).map((item) => (
                      <TableRow key={item.id}>
                        <TableCell><button type="button" className="font-medium text-slate-900 hover:text-slate-700" onClick={() => pushToTarget("return", item.challan_no, item)}>{item.challan_no || "—"}</button></TableCell>
                        <TableCell><button type="button" className="font-medium text-slate-900 hover:text-slate-700" onClick={() => pushToTarget("dispatch", item.dispatch_no, item)}>{item.dispatch_no || "—"}</button></TableCell>
                        <TableCell><button type="button" className="font-medium text-slate-900 hover:text-slate-700" onClick={() => pushToTarget("vendor", item.vendor_name)}>{item.vendor_name || "—"}</button></TableCell>
                        <TableCell>{formatDate(item.date)}</TableCell>
                        <TableCell>{formatNumber(item.pieces_received)}</TableCell>
                        <TableCell>{formatNumber(item.pieces_left)}</TableCell>
                        <TableCell>{formatNumber(item.pieces_defected)}</TableCell>
                        <TableCell>{formatNumber(item.job_work_amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>

              <Card className="p-4 rounded-xl border border-slate-200 bg-white shadow-sm">
                <h2 className="mb-3 text-lg font-semibold text-slate-900">Warehouse</h2>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Warehouse</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Pieces Received</TableHead>
                      <TableHead>Pieces Shipped</TableHead>
                      <TableHead>Available Pieces</TableHead>
                      <TableHead>Location</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data.warehouse || []).length === 0 ? (<TableRow><TableCell colSpan={6} className="py-6 text-center text-slate-500">No warehouse entries found.</TableCell></TableRow>) : (data.warehouse || []).map((item, index) => (
                      <TableRow key={`${item.warehouse}-${index}`}>
                        <TableCell><button type="button" className="font-medium text-slate-900 hover:text-slate-700" onClick={() => pushToTarget("warehouse", item.warehouse, item)}>{item.warehouse || "Main Warehouse"}</button></TableCell>
                        <TableCell>{formatDate(item.date)}</TableCell>
                        <TableCell>{formatNumber(item.pieces_received)}</TableCell>
                        <TableCell>{formatNumber(item.pieces_shipped)}</TableCell>
                        <TableCell>{formatNumber(item.available_pieces)}</TableCell>
                        <TableCell>{item.location || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>

              <Card className="p-4 rounded-xl border border-slate-200 bg-white shadow-sm">
                <h2 className="mb-3 text-lg font-semibold text-slate-900">Shipments</h2>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Shipment No.</TableHead>
                      <TableHead>Invoice No.</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Shipment Date</TableHead>
                      <TableHead>Pieces</TableHead>
                      <TableHead>Transport</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data.shipments || []).length === 0 ? (<TableRow><TableCell colSpan={6} className="py-6 text-center text-slate-500">No shipments found.</TableCell></TableRow>) : (data.shipments || []).map((shipment) => (
                      <TableRow key={shipment.id}>
                        <TableCell><button type="button" className="font-medium text-slate-900 hover:text-slate-700" onClick={() => pushToTarget("shipment", shipment.shipment_no, shipment)}>{shipment.shipment_no || "—"}</button></TableCell>
                        <TableCell><button type="button" className="font-medium text-slate-900 hover:text-slate-700" onClick={() => pushToTarget("invoice", shipment.invoice_no)}>{shipment.invoice_no || "—"}</button></TableCell>
                        <TableCell>{shipment.customer || "—"}</TableCell>
                        <TableCell>{formatDate(shipment.shipment_date)}</TableCell>
                        <TableCell>{formatNumber(shipment.pieces)}</TableCell>
                        <TableCell>{shipment.transport || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>

              <Card className="p-4 rounded-xl border border-slate-200 bg-white shadow-sm">
                <h2 className="mb-3 text-lg font-semibold text-slate-900">Article Timeline</h2>
                <div className="space-y-3">
                  {(data.timeline || []).map((item, index) => (
                    <div key={`${item.label}-${index}`} className="flex items-center gap-3 rounded-lg border border-slate-200 p-3">
                      <div className="rounded-full bg-slate-900 px-2 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white">{index + 1}</div>
                      <div className="flex-1">
                        <div className="font-medium text-slate-900">{item.label}</div>
                        <div className="text-sm text-slate-500">{formatDate(item.date)}</div>
                      </div>
                      <Badge variant="secondary">Clickable</Badge>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}

          {view === "product" && (
            <div className="space-y-4">
              <Card className="p-4 rounded-xl border border-slate-200 bg-white shadow-sm">
                <h2 className="mb-3 text-lg font-semibold text-slate-900">Product Summary</h2>
                <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                  <div><div className="text-xs uppercase tracking-[0.2em] text-slate-500">Total Articles</div><div className="text-xl font-semibold text-slate-900">{formatNumber(data.summary?.total_articles)}</div></div>
                  <div><div className="text-xs uppercase tracking-[0.2em] text-slate-500">Total Orders</div><div className="text-xl font-semibold text-slate-900">{formatNumber(data.summary?.total_orders)}</div></div>
                  <div><div className="text-xs uppercase tracking-[0.2em] text-slate-500">Total Fabric Used</div><div className="text-xl font-semibold text-slate-900">{formatNumber(data.summary?.total_fabric_used)}</div></div>
                  <div><div className="text-xs uppercase tracking-[0.2em] text-slate-500">Total Expected Pieces</div><div className="text-xl font-semibold text-slate-900">{formatNumber(data.summary?.total_expected_pieces)}</div></div>
                  <div><div className="text-xs uppercase tracking-[0.2em] text-slate-500">Total Pieces Received</div><div className="text-xl font-semibold text-slate-900">{formatNumber(data.summary?.total_pieces_received)}</div></div>
                  <div><div className="text-xs uppercase tracking-[0.2em] text-slate-500">Total Shipment</div><div className="text-xl font-semibold text-slate-900">{formatNumber(data.summary?.total_shipment)}</div></div>
                </div>
              </Card>
              <Card className="p-4 rounded-xl border border-slate-200 bg-white shadow-sm">
                <h2 className="mb-3 text-lg font-semibold text-slate-900">Articles</h2>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Article Number</TableHead>
                      <TableHead>Brand</TableHead>
                      <TableHead>Order No.</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data.articles || []).length === 0 ? (<TableRow><TableCell colSpan={4} className="py-6 text-center text-slate-500">No articles found.</TableCell></TableRow>) : (data.articles || []).map((item) => (
                      <TableRow key={item.id}>
                        <TableCell><button type="button" className="font-medium text-slate-900 hover:text-slate-700" onClick={() => pushToTarget("article", item.order_number || item.id)}>{item.order_number || item.id}</button></TableCell>
                        <TableCell>{item.buyer_name || "—"}</TableCell>
                        <TableCell>{item.order_number || "—"}</TableCell>
                        <TableCell><Badge variant="secondary">{item.stage || "Open"}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            </div>
          )}

          {view === "brand" && (
            <div className="space-y-4">
              <Card className="p-4 rounded-xl border border-slate-200 bg-white shadow-sm">
                <h2 className="mb-3 text-lg font-semibold text-slate-900">Brand Summary</h2>
                <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                  <div><div className="text-xs uppercase tracking-[0.2em] text-slate-500">Total Products</div><div className="text-xl font-semibold text-slate-900">{formatNumber(data.summary?.total_products)}</div></div>
                  <div><div className="text-xs uppercase tracking-[0.2em] text-slate-500">Total Articles</div><div className="text-xl font-semibold text-slate-900">{formatNumber(data.summary?.total_articles)}</div></div>
                  <div><div className="text-xs uppercase tracking-[0.2em] text-slate-500">Total Orders</div><div className="text-xl font-semibold text-slate-900">{formatNumber(data.summary?.total_orders)}</div></div>
                  <div><div className="text-xs uppercase tracking-[0.2em] text-slate-500">Total Dispatches</div><div className="text-xl font-semibold text-slate-900">{formatNumber(data.summary?.total_dispatches)}</div></div>
                  <div><div className="text-xs uppercase tracking-[0.2em] text-slate-500">Warehouse Stock</div><div className="text-xl font-semibold text-slate-900">{formatNumber(data.summary?.warehouse_stock)}</div></div>
                  <div><div className="text-xs uppercase tracking-[0.2em] text-slate-500">Total Shipment</div><div className="text-xl font-semibold text-slate-900">{formatNumber(data.summary?.total_shipment)}</div></div>
                </div>
              </Card>
              <Card className="p-4 rounded-xl border border-slate-200 bg-white shadow-sm">
                <h2 className="mb-3 text-lg font-semibold text-slate-900">Products</h2>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>Brand</TableHead>
                      <TableHead>Dispatches</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data.products || []).length === 0 ? (<TableRow><TableCell colSpan={3} className="py-6 text-center text-slate-500">No products found.</TableCell></TableRow>) : (data.products || []).map((item, index) => (
                      <TableRow key={`${item.product_type_id || item.id}-${index}`}>
                        <TableCell><button type="button" className="font-medium text-slate-900 hover:text-slate-700" onClick={() => pushToTarget("product", item.product_type_name || item.product_name)}>{item.product_type_name || item.product_name || "—"}</button></TableCell>
                        <TableCell>{item.brand_name || data.brand}</TableCell>
                        <TableCell>{formatNumber(item.expected_pieces)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            </div>
          )}

          {view === "material" && (
            <div className="space-y-4">
              <Card className="p-4 rounded-xl border border-slate-200 bg-white shadow-sm">
                <h2 className="mb-3 text-lg font-semibold text-slate-900">Material Summary</h2>
                <div className="grid gap-3 md:grid-cols-3">
                  <div><div className="text-xs uppercase tracking-[0.2em] text-slate-500">Purchased</div><div className="text-xl font-semibold text-slate-900">{formatNumber(data.summary?.purchased)}</div></div>
                  <div><div className="text-xs uppercase tracking-[0.2em] text-slate-500">Dispatched</div><div className="text-xl font-semibold text-slate-900">{formatNumber(data.summary?.dispatched)}</div></div>
                  <div><div className="text-xs uppercase tracking-[0.2em] text-slate-500">Available</div><div className="text-xl font-semibold text-slate-900">{formatNumber(data.summary?.available)}</div></div>
                </div>
              </Card>
              <Card className="p-4 rounded-xl border border-slate-200 bg-white shadow-sm">
                <h2 className="mb-3 text-lg font-semibold text-slate-900">Material Purchase</h2>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Supplier</TableHead>
                      <TableHead>Purchase Date</TableHead>
                      <TableHead>Quantity Purchased</TableHead>
                      <TableHead>Current Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data.purchase || []).length === 0 ? (<TableRow><TableCell colSpan={4} className="py-6 text-center text-slate-500">No purchase records found.</TableCell></TableRow>) : (data.purchase || []).map((item) => (
                      <TableRow key={item.id}>
                        <TableCell><button type="button" className="font-medium text-slate-900 hover:text-slate-700" onClick={() => pushToTarget("supplier", item.supplier)}>{item.supplier || "—"}</button></TableCell>
                        <TableCell>{formatDate(item.purchase_date)}</TableCell>
                        <TableCell>{formatNumber(item.quantity_purchased)}</TableCell>
                        <TableCell>{formatNumber(item.current_balance)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            </div>
          )}

          {view === "order" && (
            <div className="space-y-4">
              <Card className="p-4 rounded-xl border border-slate-200 bg-white shadow-sm">
                <h2 className="mb-3 text-lg font-semibold text-slate-900">Order Lifecycle</h2>
                <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                  <div><div className="text-xs uppercase tracking-[0.2em] text-slate-500">Buyer</div><div className="text-xl font-semibold text-slate-900">{data.summary?.buyer || "—"}</div></div>
                  <div><div className="text-xs uppercase tracking-[0.2em] text-slate-500">Order Date</div><div className="text-xl font-semibold text-slate-900">{formatDate(data.summary?.order_date)}</div></div>
                  <div><div className="text-xs uppercase tracking-[0.2em] text-slate-500">Delivery Date</div><div className="text-xl font-semibold text-slate-900">{formatDate(data.summary?.delivery_date)}</div></div>
                  <div><div className="text-xs uppercase tracking-[0.2em] text-slate-500">Order Status</div><div className="text-xl font-semibold text-slate-900">{data.summary?.order_status || "—"}</div></div>
                  <div><div className="text-xs uppercase tracking-[0.2em] text-slate-500">Quantity Ordered</div><div className="text-xl font-semibold text-slate-900">{formatNumber(data.summary?.quantity_ordered)}</div></div>
                  <div><div className="text-xs uppercase tracking-[0.2em] text-slate-500">Pending Quantity</div><div className="text-xl font-semibold text-slate-900">{formatNumber(data.summary?.pending_quantity)}</div></div>
                </div>
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
