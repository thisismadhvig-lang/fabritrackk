import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, fmtDate, fmtNum } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, RefreshCcw, Truck } from "lucide-react";
import UniversalPrintButton from "@/components/erp/UniversalPrintButton";

const initialFilters = {
  search: "",
  brand: "all",
  product_type: "all",
  location: "all",
  status: "all",
};

function SummaryCard({ label, value, tone = "default" }) {
  const tones = {
    positive: "bg-emerald-50 text-emerald-700",
    warning: "bg-amber-50 text-amber-700",
    danger: "bg-rose-50 text-rose-700",
    default: "bg-slate-100 text-slate-700",
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{label}</div>
      <div className={`mt-2 inline-flex rounded-full px-3 py-1 text-sm font-semibold ${tones[tone]}`}>{value}</div>
    </div>
  );
}

export default function Warehouse() {
  const navigate = useNavigate();
  const location = useLocation();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState(initialFilters);
  const [selectedPrintIds, setSelectedPrintIds] = useState([]);

  const loadWarehouse = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get("/warehouse", {
        params: {
          search: filters.search || undefined,
          brand: filters.brand === "all" ? undefined : filters.brand,
          product_type: filters.product_type === "all" ? undefined : filters.product_type,
          location: filters.location === "all" ? undefined : filters.location,
          status: filters.status === "all" ? undefined : filters.status,
        },
      });
      setItems(response.data?.items || []);
    } catch (error) {
      console.error(error);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [filters.brand, filters.location, filters.product_type, filters.search, filters.status]);

  useEffect(() => {
    loadWarehouse();
  }, [loadWarehouse]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const search = params.get("search") || "";
    if (search) {
      setFilters((prev) => ({ ...prev, search }));
    }
  }, [location.search]);

  const filterOptions = useMemo(() => {
    const brands = Array.from(new Set(items.map((item) => item.brand).filter(Boolean))).sort();
    const products = Array.from(new Set(items.map((item) => item.product_type_name).filter(Boolean))).sort();
    const locations = Array.from(new Set(items.map((item) => item.warehouse_location).filter(Boolean))).sort();
    const statuses = Array.from(new Set(items.map((item) => item.status).filter(Boolean))).sort();
    return { brands, products, locations, statuses };
  }, [items]);

  const summary = useMemo(() => {
    const available = items.filter((item) => item.status === "Available").length;
    const reserved = items.filter((item) => item.status === "Reserved").length;
    const low = items.filter((item) => item.status === "Low Stock").length;
    const outOfStock = items.filter((item) => item.status === "Out of Stock").length;
    const pieces = items.reduce((sum, item) => sum + Number(item.pieces_available || 0), 0);
    return { available, reserved, low, outOfStock, pieces };
  }, [items]);

  return (
    <div data-testid="warehouse-page" className="space-y-4">
      <PageHeader
        title="Warehouse"
        subtitle="Finished-goods stock availability for ready-to-ship inventory"
        testid="warehouse-header"
        actions={
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => loadWarehouse()} className="gap-2">
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </Button>
            <UniversalPrintButton
              moduleName="Warehouse"
              rows={items}
              columns={[
                { key: "article_number", label: "Article" },
                { key: "product_type_name", label: "Product" },
                { key: "brand", label: "Brand" },
                { key: "warehouse_location", label: "Location" },
                { key: "pieces_available", label: "Available" },
                { key: "status", label: "Status" },
              ]}
              summary={[{ label: "Total Available Pieces", value: fmtNum(summary.pieces) }]}
              reportTitle="Warehouse Stock Report"
              reportPeriod="Current Warehouse View"
              selectedRows={items.filter((item) => selectedPrintIds.includes(`${item.article_number || ""}-${item.product_type_id || ""}`))}
              filteredRows={items}
              allRows={items}
              selectedIds={selectedPrintIds}
              onSelectedIdsChange={setSelectedPrintIds}
            />
          </div>
        }
      />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <SummaryCard label="Available" value={`${summary.available}`} tone="positive" />
        <SummaryCard label="Reserved" value={`${summary.reserved}`} tone="warning" />
        <SummaryCard label="Low Stock" value={`${summary.low}`} tone="warning" />
        <SummaryCard label="Out of Stock" value={`${summary.outOfStock}`} tone="danger" />
        <SummaryCard label="Available Pieces" value={`${summary.pieces}`} tone="positive" />
      </div>

      <Card className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <label className="mb-1 flex text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Search</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={filters.search}
                onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
                placeholder="Article / Brand / Product"
                className="pl-9"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 flex text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Brand</label>
            <Select value={filters.brand} onValueChange={(value) => setFilters((prev) => ({ ...prev, brand: value }))}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Brands</SelectItem>
                {filterOptions.brands.map((brand) => (
                  <SelectItem key={brand} value={brand}>
                    {brand}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="mb-1 flex text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Product</label>
            <Select value={filters.product_type} onValueChange={(value) => setFilters((prev) => ({ ...prev, product_type: value }))}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Products</SelectItem>
                {filterOptions.products.map((product) => (
                  <SelectItem key={product} value={product}>
                    {product}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="mb-1 flex text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Location</label>
            <Select value={filters.location} onValueChange={(value) => setFilters((prev) => ({ ...prev, location: value }))}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Locations</SelectItem>
                {filterOptions.locations.map((location) => (
                  <SelectItem key={location} value={location}>
                    {location}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="mb-1 flex text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Status</label>
            <Select value={filters.status} onValueChange={(value) => setFilters((prev) => ({ ...prev, status: value }))}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {filterOptions.statuses.map((status) => (
                  <SelectItem key={status} value={status}>
                    {status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div className="px-6 py-12 text-center text-sm text-slate-500">Loading warehouse stock…</div>
        ) : items.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-slate-500">No finished-goods stock matches the current filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                <tr>
                  <th className="border-b border-slate-200 px-3 py-3">Article</th>
                  <th className="border-b border-slate-200 px-3 py-3">Product</th>
                  <th className="border-b border-slate-200 px-3 py-3">Brand</th>
                  <th className="border-b border-slate-200 px-3 py-3">Location</th>
                  <th className="border-b border-slate-200 px-3 py-3">Received</th>
                  <th className="border-b border-slate-200 px-3 py-3">Shipped</th>
                  <th className="border-b border-slate-200 px-3 py-3">Available</th>
                  <th className="border-b border-slate-200 px-3 py-3">Status</th>
                  <th className="border-b border-slate-200 px-3 py-3">Updated</th>
                  <th className="border-b border-slate-200 px-3 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={`${item.article_number}-${item.product_type_id}`} className="odd:bg-white even:bg-slate-50/70">
                    <td className="px-3 py-3 font-semibold text-slate-900">
                      <button
                        type="button"
                        className="text-blue-700 underline decoration-blue-200 underline-offset-2 hover:text-blue-900"
                        onClick={() => navigate(`/production-traceability?view_by=article&search=${encodeURIComponent(item.article_number || "")}`)}
                      >
                        {item.article_number || "—"}
                      </button>
                    </td>
                    <td className="px-3 py-3 text-slate-700">{item.product_name || item.product_type_name || "—"}</td>
                    <td className="px-3 py-3 text-slate-700">{item.brand || "—"}</td>
                    <td className="px-3 py-3 text-slate-700">{item.warehouse_location || "—"}</td>
                    <td className="px-3 py-3 text-slate-700">{fmtNum(item.pieces_received || 0)}</td>
                    <td className="px-3 py-3 text-slate-700">{fmtNum(item.pieces_shipped || 0)}</td>
                    <td className="px-3 py-3 text-slate-700">{fmtNum(item.pieces_available || 0)}</td>
                    <td className="px-3 py-3">
                      <Badge className={item.status === "Available" ? "bg-emerald-100 text-emerald-700" : item.status === "Reserved" ? "bg-amber-100 text-amber-700" : item.status === "Low Stock" ? "bg-yellow-100 text-yellow-700" : "bg-rose-100 text-rose-700"}>{item.status || "—"}</Badge>
                    </td>
                    <td className="px-3 py-3 text-slate-700">{fmtDate(item.last_updated)}</td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="gap-2"
                          onClick={() =>
                            navigate(
                              `/shipments?article=${encodeURIComponent(item.article_number || "")}&brand=${encodeURIComponent(item.brand || "")}&product_type_id=${encodeURIComponent(item.product_type_id || "")}&product_type_name=${encodeURIComponent(item.product_type_name || "")}&available_pieces=${encodeURIComponent(item.pieces_available || 0)}`
                            )
                          }
                        >
                          <Truck className="h-3.5 w-3.5" />
                          Shipment
                        </Button>
                      </div>
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
