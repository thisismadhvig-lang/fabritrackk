import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, fmtDate, fmtNum } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";

const emptyFilters = {
  search: "",
  dateFrom: "",
  dateTo: "",
  dispatchNo: "",
  challanNo: "",
  article: "",
  brand: "",
  productType: "",
};

export default function Ledger() {
  const [vendors, setVendors] = useState([]);
  const [vendorId, setVendorId] = useState("");
  const [ledger, setLedger] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState(emptyFilters);

  useEffect(() => {
    let cancelled = false;
    api
      .get("/vendors", { params: { include_archived: true } })
      .then((response) => {
        if (cancelled) return;
        const vendorList = response.data || [];
        setVendors(vendorList);
        setVendorId((prev) => prev || vendorList[0]?.id || "");
      })
      .catch(() => {
        if (!cancelled) setVendors([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!vendorId) {
      setLedger(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api
      .get(`/vendors/${vendorId}/ledger`)
      .then((response) => {
        if (!cancelled) setLedger(response.data || null);
      })
      .catch(() => {
        if (!cancelled) setLedger(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [vendorId]);

  const summary = ledger?.summary || {};
  const groups = useMemo(() => ledger?.groups || [], [ledger]);

  const filteredGroups = useMemo(() => {
    const query = filters.search.trim().toLowerCase();
    return groups.filter((group) => {
      const dispatchDate = group.date || "";
      const matchesDate = (!filters.dateFrom || dispatchDate >= filters.dateFrom) && (!filters.dateTo || dispatchDate <= filters.dateTo);
      const matchesDispatch = !filters.dispatchNo || String(group.dispatch_no || "").toLowerCase().includes(filters.dispatchNo.toLowerCase());
      const matchesBrand = !filters.brand || String(group.brand_name || "").toLowerCase().includes(filters.brand.toLowerCase());
      const matchesProduct = !filters.productType || String(group.product_type || "").toLowerCase().includes(filters.productType.toLowerCase());
      const receipts = group.related_receipts || [];
      const matchesReceipt = receipts.some((receipt) => {
        const challan = String(receipt.challan_no || "").toLowerCase();
        const article = String(receipt.article_barcode || "").toLowerCase();
        const receiptDate = receipt.date || "";
        const matchesChallan = !filters.challanNo || challan.includes(filters.challanNo.toLowerCase());
        const matchesArticle = !filters.article || article.includes(filters.article.toLowerCase());
        const matchesDateRange = (!filters.dateFrom || receiptDate >= filters.dateFrom) && (!filters.dateTo || receiptDate <= filters.dateTo);
        return matchesChallan && matchesArticle && matchesDateRange;
      });
      const matchesSearch = !query || [group.dispatch_no, group.supplier_name, group.fabric, group.brand_name, group.product_type, group.related_receipts?.map((r) => `${r.challan_no} ${r.article_barcode}`).join(" ")].join(" ").toLowerCase().includes(query);
      return matchesDate && matchesDispatch && matchesBrand && matchesProduct && (matchesReceipt || !filters.challanNo && !filters.article && !filters.dateFrom && !filters.dateTo || filters.challanNo || filters.article || filters.dateFrom || filters.dateTo) && matchesSearch;
    });
  }, [groups, filters]);

  const filteredSummary = useMemo(() => {
    return filteredGroups.reduce(
      (acc, group) => ({
        total_dispatches: acc.total_dispatches + 1,
        total_fabric_dispatched: acc.total_fabric_dispatched + Number(group.quantity || 0),
        total_pieces_received: acc.total_pieces_received + Number(group.total_received || 0),
        total_pieces_pending: acc.total_pieces_pending + Number(group.total_pending || 0),
        total_defective_pieces: acc.total_defective_pieces + Number(group.total_defective || 0),
      }),
      {
        total_dispatches: 0,
        total_fabric_dispatched: 0,
        total_pieces_received: 0,
        total_pieces_pending: 0,
        total_defective_pieces: 0,
      }
    );
  }, [filteredGroups]);

  return (
    <div data-testid="ledger-page" className="space-y-4">
      <PageHeader
        title="Production Ledger"
        subtitle="Read-only vendor-wise job work ledger generated from fabric dispatches and returns & QC receipts"
        actions={
          <Select value={vendorId} onValueChange={setVendorId}>
            <SelectTrigger data-testid="ledger-vendor-select" className="w-72">
              <SelectValue placeholder="Select Vendor" />
            </SelectTrigger>
            <SelectContent>
              {vendors.map((vendor) => (
                <SelectItem key={vendor.id} value={vendor.id}>
                  {vendor.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      {vendorId ? (
        <>
          <Card className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm">
            <div className="grid gap-3 lg:grid-cols-4 xl:grid-cols-6">
              <div className="lg:col-span-2 xl:col-span-2">
                <label className="mb-1 flex text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Search</label>
                <Input
                  value={filters.search}
                  onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
                  placeholder="Dispatch / Challan / Article / Brand / Supplier / Fabric"
                />
              </div>
              <div>
                <label className="mb-1 flex text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Date From</label>
                <Input type="date" value={filters.dateFrom} onChange={(event) => setFilters((prev) => ({ ...prev, dateFrom: event.target.value }))} />
              </div>
              <div>
                <label className="mb-1 flex text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Date To</label>
                <Input type="date" value={filters.dateTo} onChange={(event) => setFilters((prev) => ({ ...prev, dateTo: event.target.value }))} />
              </div>
              <div>
                <label className="mb-1 flex text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Dispatch No.</label>
                <Input value={filters.dispatchNo} onChange={(event) => setFilters((prev) => ({ ...prev, dispatchNo: event.target.value }))} placeholder="D-101" />
              </div>
              <div>
                <label className="mb-1 flex text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Challan No.</label>
                <Input value={filters.challanNo} onChange={(event) => setFilters((prev) => ({ ...prev, challanNo: event.target.value }))} placeholder="CH-001" />
              </div>
              <div>
                <label className="mb-1 flex text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Article</label>
                <Input value={filters.article} onChange={(event) => setFilters((prev) => ({ ...prev, article: event.target.value }))} placeholder="ART-100" />
              </div>
              <div>
                <label className="mb-1 flex text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Brand</label>
                <Input value={filters.brand} onChange={(event) => setFilters((prev) => ({ ...prev, brand: event.target.value }))} placeholder="Brand" />
              </div>
              <div>
                <label className="mb-1 flex text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Product Type</label>
                <Input value={filters.productType} onChange={(event) => setFilters((prev) => ({ ...prev, productType: event.target.value }))} placeholder="Formal Shirt" />
              </div>
            </div>
          </Card>

          <Card className="rounded-[20px] border border-slate-200 bg-slate-50/70 p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500">Vendor Summary</div>
                <div className="mt-1 text-lg font-semibold text-slate-900">{vendors.find((vendor) => vendor.id === vendorId)?.name || "Selected Vendor"}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge className="bg-white text-slate-700">Dispatches: {filteredSummary.total_dispatches}</Badge>
                <Badge className="bg-white text-slate-700">Fabric Dispatched: {filteredSummary.total_fabric_dispatched.toFixed(2)} kg</Badge>
                <Badge className="bg-white text-slate-700">Pieces Received: {filteredSummary.total_pieces_received}</Badge>
                <Badge className="bg-white text-slate-700">Pieces Pending: {filteredSummary.total_pieces_pending}</Badge>
                <Badge className="bg-white text-slate-700">Defective Pieces: {filteredSummary.total_defective_pieces}</Badge>
              </div>
            </div>
          </Card>

          <Card className="overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-sm">
            {loading ? (
              <div className="px-6 py-12 text-center text-sm text-slate-500">Loading ledger…</div>
            ) : filteredGroups.length === 0 ? (
              <div className="px-6 py-12 text-center text-sm text-slate-500">No job work records match the current filters.</div>
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-[1200px] space-y-3 p-3">
                  {filteredGroups.map((group) => (
                    <div key={group.id} className="overflow-hidden rounded-[16px] border border-slate-200 bg-white">
                      <div className="flex flex-wrap items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
                        <div>
                          <div className="text-sm font-semibold text-slate-900">Dispatch {group.dispatch_no}</div>
                          <div className="mt-1 text-sm text-slate-500">{fmtDate(group.date)} • Supplier {group.supplier_name || "—"} • Brand {group.brand_name || "—"} • Product Type {group.product_type || "—"}</div>
                        </div>
                        <div className="flex flex-wrap gap-2 text-sm">
                          <Badge className="bg-slate-100 text-slate-700">Fabric: {group.fabric || "—"}</Badge>
                          <Badge className="bg-slate-100 text-slate-700">Qty: {group.quantity.toFixed(2)} {group.unit}</Badge>
                          <Badge className="bg-slate-100 text-slate-700">Expected Pieces: {group.expected_pieces}</Badge>
                          <Badge className="bg-emerald-100 text-emerald-700">Received: {group.total_received}</Badge>
                          <Badge className={group.total_pending > 0 ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-700"}>Pending: {group.total_pending}</Badge>
                        </div>
                      </div>
                      <div className="grid gap-4 p-3 lg:grid-cols-2">
                        <div className="overflow-x-auto">
                          <table className="min-w-full border-separate border-spacing-0 text-sm">
                            <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                              <tr>
                                <th className="border-b border-slate-200 px-3 py-2">Dispatch No.</th>
                                <th className="border-b border-slate-200 px-3 py-2">Date</th>
                                <th className="border-b border-slate-200 px-3 py-2">Supplier Name</th>
                                <th className="border-b border-slate-200 px-3 py-2">Brand Name</th>
                                <th className="border-b border-slate-200 px-3 py-2">Fabric</th>
                                <th className="border-b border-slate-200 px-3 py-2">Quantity</th>
                                <th className="border-b border-slate-200 px-3 py-2">Unit</th>
                                <th className="border-b border-slate-200 px-3 py-2">Rolls</th>
                                <th className="border-b border-slate-200 px-3 py-2">Product Type</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr className="odd:bg-white even:bg-slate-50/70">
                                <td className="px-3 py-2 font-semibold text-slate-900"><Link className="text-blue-700 hover:underline" to={`/dispatch?id=${encodeURIComponent(group.id || "")}`}>{group.dispatch_no}</Link></td>
                                <td className="px-3 py-2 text-slate-700">{fmtDate(group.date)}</td>
                                <td className="px-3 py-2 text-slate-700">{group.supplier_name || "—"}</td>
                                <td className="px-3 py-2 text-slate-700">{group.brand_name || "—"}</td>
                                <td className="px-3 py-2 text-slate-700">{group.fabric || "—"}</td>
                                <td className="px-3 py-2 text-slate-700">{fmtNum(group.quantity)}</td>
                                <td className="px-3 py-2 text-slate-700">{group.unit || "kg"}</td>
                                <td className="px-3 py-2 text-slate-700">{group.rolls || 1}</td>
                                <td className="px-3 py-2 text-slate-700">{group.product_type || "—"}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="min-w-full border-separate border-spacing-0 text-sm">
                            <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                              <tr>
                                <th className="border-b border-slate-200 px-3 py-2">Challan No.</th>
                                <th className="border-b border-slate-200 px-3 py-2">Date</th>
                                <th className="border-b border-slate-200 px-3 py-2">Article Number / Barcode</th>
                                <th className="border-b border-slate-200 px-3 py-2">Lot Number</th>
                                <th className="border-b border-slate-200 px-3 py-2">Pieces Received</th>
                                <th className="border-b border-slate-200 px-3 py-2">Fabric Consumed</th>
                                <th className="border-b border-slate-200 px-3 py-2">Pieces Left</th>
                                <th className="border-b border-slate-200 px-3 py-2">Pieces Defected</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(group.related_receipts || []).length === 0 ? (
                                <tr className="odd:bg-white even:bg-slate-50/70">
                                  <td colSpan={7} className="px-3 py-6 text-center text-slate-500">No challans linked to this dispatch</td>
                                </tr>
                              ) : (
                                (group.related_receipts || []).map((receipt, index) => (
                                  <tr key={`${group.id}-${receipt.id || index}`} className="odd:bg-white even:bg-slate-50/70">
                                    <td className="px-3 py-2 font-semibold text-slate-900"><Link className="text-blue-700 hover:underline" to={`/returns?dispatch=${encodeURIComponent(group.id || "")}&challan=${encodeURIComponent(receipt.challan_no || "")}`}>{receipt.challan_no || "—"}</Link></td>
                                    <td className="px-3 py-2 text-slate-700">{fmtDate(receipt.date)}</td>
                                    <td className="px-3 py-2 text-slate-700">{receipt.article_barcode || "—"}</td>
                                    <td className="px-3 py-2 text-slate-700">{receipt.lot_no || "—"}</td>
                                    <td className="px-3 py-2 text-slate-700">{fmtNum(receipt.pieces_received)}</td>
                                    <td className="px-3 py-2 text-slate-700">{fmtNum(receipt.fabric_consumed_kg || 0)}</td>
                                    <td className="px-3 py-2 text-slate-700">{fmtNum(receipt.pieces_left)}</td>
                                    <td className="px-3 py-2 text-slate-700">{fmtNum(receipt.pieces_defected)}</td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
        </>
      ) : (
        <Card className="rounded-[20px] border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
          Select a vendor to view the read-only job work ledger.
        </Card>
      )}
    </div>
  );
}
