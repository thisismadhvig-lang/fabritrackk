import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api, fmtDate, fmtMoney } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import UniversalPrintButton from "@/components/erp/UniversalPrintButton";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowDown, ArrowUp, ArrowUpDown, Download, Filter, Printer, Search } from "lucide-react";

const statusOptions = ["Pending", "Partial", "Paid", "Received"];
const transactionOptions = ["Purchase", "Dispatch"];

function buildReferenceLink(row) {
  if (!row.reference_id) return null;
  if (row.source_type === "material_inventory") return `/material-inventory?id=${encodeURIComponent(row.reference_id)}`;
  if (row.source_type === "material_dispatch") return `/material-dispatch?id=${encodeURIComponent(row.reference_id)}`;
  return null;
}

export default function MaterialLedger() {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [materialFilter, setMaterialFilter] = useState("all");
  const [partyFilter, setPartyFilter] = useState("all");
  const [transactionFilter, setTransactionFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortBy, setSortBy] = useState("date");
  const [sortDir, setSortDir] = useState("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedPrintIds, setSelectedPrintIds] = useState([]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get("/material-ledger");
      setRows(res.data?.rows || []);
      setSummary(res.data?.summary || {});
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to load material ledger");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const materialOptions = useMemo(() => {
    return Array.from(new Set(rows.map((row) => row.material).filter(Boolean))).sort();
  }, [rows]);

  const partyOptions = useMemo(() => {
    return Array.from(new Set(rows.map((row) => row.party).filter(Boolean))).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesSearch = !term || [row.reference_no, row.material, row.party].filter(Boolean).join(" ").toLowerCase().includes(term);
      const matchesMaterial = materialFilter === "all" || row.material === materialFilter;
      const matchesParty = partyFilter === "all" || row.party === partyFilter;
      const matchesTransaction = transactionFilter === "all" || row.transaction_type === transactionFilter;
      const matchesPayment = paymentFilter === "all" || row.payment_status === paymentFilter;
      const rowDate = row.date ? new Date(row.date) : null;
      const matchesFrom = !dateFrom || !rowDate || rowDate >= new Date(`${dateFrom}T00:00:00`);
      const matchesTo = !dateTo || !rowDate || rowDate <= new Date(`${dateTo}T23:59:59`);
      return matchesSearch && matchesMaterial && matchesParty && matchesTransaction && matchesPayment && matchesFrom && matchesTo;
    });
  }, [dateFrom, dateTo, materialFilter, partyFilter, paymentFilter, rows, search, transactionFilter]);

  const sorted = useMemo(() => {
    const data = [...filtered];
    data.sort((a, b) => {
      const av = a[sortBy];
      const bv = b[sortBy];
      if (sortBy === "date") {
        const da = av ? new Date(av).getTime() : 0;
        const db = bv ? new Date(bv).getTime() : 0;
        return sortDir === "asc" ? da - db : db - da;
      }
      if (sortBy === "amount") {
        return sortDir === "asc" ? Number(av || 0) - Number(bv || 0) : Number(bv || 0) - Number(av || 0);
      }
      const sa = String(av || "").toLowerCase();
      const sb = String(bv || "").toLowerCase();
      if (sa < sb) return sortDir === "asc" ? -1 : 1;
      if (sa > sb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return data;
  }, [filtered, sortBy, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pageRows = sorted.slice(pageStart, pageStart + pageSize);

  useEffect(() => {
    setPage(1);
  }, [search, materialFilter, partyFilter, transactionFilter, paymentFilter, dateFrom, dateTo, pageSize]);

  const toggleSort = (key) => {
    if (sortBy === key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(key);
    setSortDir("asc");
  };

  const renderSortIcon = (key) => {
    if (sortBy !== key) return <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />;
    return sortDir === "asc" ? <ArrowUp className="h-3.5 w-3.5 text-slate-700" /> : <ArrowDown className="h-3.5 w-3.5 text-slate-700" />;
  };

  const exportLedger = async () => {
    try {
      const res = await api.get("/export/material-ledger", { responseType: "blob" });
      const blob = new Blob([res.data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `material_ledger_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Excel exported");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Export failed");
    }
  };

  const printLedger = () => window.print();

  return (
    <div data-testid="material-ledger-page">
      <PageHeader
        title="Material Ledger"
        subtitle="Read-only audit trail of material purchases, dispatches, and payment status"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={exportLedger} className="border-slate-300">
              <Download className="mr-2 h-4 w-4" /> Export Excel
            </Button>
            <UniversalPrintButton
              moduleName="Material Ledger"
              rows={sorted}
              columns={[
                { key: "date", label: "Date" },
                { key: "transaction_type", label: "Transaction Type" },
                { key: "reference_no", label: "Reference" },
                { key: "party", label: "Party" },
                { key: "material", label: "Material" },
                { key: "amount", label: "Amount" },
              ]}
              summary={[{ label: "Current Stock", value: Number(summary.current_stock || 0).toLocaleString() }]}
              reportTitle="Material Ledger"
              reportPeriod="Filtered Material Ledger"
              selectedRows={sorted.filter((row) => selectedPrintIds.includes(row.reference_id || row.reference_no || row.id))}
              currentPageRows={pageRows}
              filteredRows={sorted}
              allRows={rows}
              selectedIds={selectedPrintIds}
              onSelectedIdsChange={setSelectedPrintIds}
            />
          </div>
        }
      />

      <Card className="mb-4 rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-5">
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Current Stock</div>
            <div className="mt-1 text-lg font-semibold text-slate-900">{Number(summary.current_stock || 0).toLocaleString(undefined, { maximumFractionDigits: 3 })}</div>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Total Purchased</div>
            <div className="mt-1 text-lg font-semibold text-slate-900">{Number(summary.total_purchased || 0).toLocaleString(undefined, { maximumFractionDigits: 3 })}</div>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Total Dispatched</div>
            <div className="mt-1 text-lg font-semibold text-slate-900">{Number(summary.total_dispatched || 0).toLocaleString(undefined, { maximumFractionDigits: 3 })}</div>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Current Stock Value</div>
            <div className="mt-1 text-lg font-semibold text-slate-900">{fmtMoney(summary.current_stock_value || 0)}</div>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Average Purchase Rate</div>
            <div className="mt-1 text-lg font-semibold text-slate-900">{fmtMoney(summary.average_purchase_rate || 0)}</div>
          </div>
        </div>
      </Card>

      <Card className="mb-4 rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-600">
            <Search className="h-4 w-4" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Ref / Material / Party" className="h-8 w-[220px] border-0 bg-transparent shadow-none" />
          </div>
          <select value={materialFilter} onChange={(e) => setMaterialFilter(e.target.value)} className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm">
            <option value="all">All Materials</option>
            {materialOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          <select value={partyFilter} onChange={(e) => setPartyFilter(e.target.value)} className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm">
            <option value="all">All Parties</option>
            {partyOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          <select value={transactionFilter} onChange={(e) => setTransactionFilter(e.target.value)} className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm">
            <option value="all">All Types</option>
            {transactionOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          <select value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value)} className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm">
            <option value="all">All Payment Status</option>
            {statusOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 w-[145px]" />
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 w-[145px]" />
        </div>
      </Card>

      <Card className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
        <Table className="text-sm">
          <TableHeader>
            <TableRow className="bg-slate-50 hover:bg-slate-50">
              {[
                ["date", "Date"],
                ["transaction_type", "Transaction Type"],
                ["reference_no", "Reference No."],
                ["party", "Supplier / Vendor"],
                ["material", "Material"],
                ["qty_in", "Qty In"],
                ["qty_out", "Qty Out"],
                ["balance", "Balance"],
                ["unit", "Unit"],
                ["rate", "Rate"],
                ["amount", "Amount"],
                ["payment_status", "Payment Status"],
              ].map(([key, label]) => (
                <TableHead key={key} className="sticky top-0 z-10 bg-slate-50 whitespace-nowrap">
                  <button type="button" onClick={() => toggleSort(key)} className="inline-flex items-center gap-1 text-left font-medium text-slate-600 hover:text-slate-900">
                    {label}
                    {renderSortIcon(key)}
                  </button>
                </TableHead>
              ))}
              <TableHead className="sticky top-0 z-10 bg-slate-50 whitespace-nowrap">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && <TableRow><TableCell colSpan={13} className="py-10 text-center text-slate-500">Loading material ledger...</TableCell></TableRow>}
            {!loading && pageRows.length === 0 && <TableRow><TableCell colSpan={13} className="py-10 text-center text-slate-500">No ledger entries found.</TableCell></TableRow>}
            {!loading && pageRows.map((row, idx) => {
              const link = buildReferenceLink(row);
              return (
                <TableRow
                  key={`${row.reference_id}-${idx}`}
                  className={idx % 2 === 0 ? "bg-white hover:bg-slate-100" : "bg-slate-50/40 hover:bg-slate-100"}
                >
                  <TableCell>{fmtDate(row.date)}</TableCell>
                  <TableCell>{row.transaction_type}</TableCell>
                  <TableCell>{link ? <a href={link} className="font-medium text-slate-900 underline-offset-2 hover:underline">{row.reference_no}</a> : <span className="text-slate-700">{row.reference_no}</span>}</TableCell>
                  <TableCell>{row.party || "—"}</TableCell>
                  <TableCell>{row.material || "—"}</TableCell>
                  <TableCell>{Number(row.qty_in || 0).toLocaleString(undefined, { maximumFractionDigits: 3 })}</TableCell>
                  <TableCell>{Number(row.qty_out || 0).toLocaleString(undefined, { maximumFractionDigits: 3 })}</TableCell>
                  <TableCell>{Number(row.balance || 0).toLocaleString(undefined, { maximumFractionDigits: 3 })}</TableCell>
                  <TableCell>{row.unit || "—"}</TableCell>
                  <TableCell>{fmtMoney(row.rate || 0)}</TableCell>
                  <TableCell>{fmtMoney(row.amount || 0)}</TableCell>
                  <TableCell>{row.payment_status || "—"}</TableCell>
                  <TableCell>
                    <span className="text-slate-500">View only</span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-slate-600">Showing {pageRows.length ? pageStart + 1 : 0} to {pageStart + pageRows.length} of {sorted.length} records</div>
        <div className="flex items-center gap-2">
          <select value={String(pageSize)} onChange={(e) => setPageSize(Number(e.target.value))} className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs">
            <option value="10">10 / page</option>
            <option value="25">25 / page</option>
            <option value="50">50 / page</option>
          </select>
          <Button type="button" variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
          <div className="min-w-[84px] text-center text-sm text-slate-700">Page {currentPage} / {totalPages}</div>
          <Button type="button" variant="outline" size="sm" disabled={currentPage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</Button>
        </div>
      </div>
    </div>
  );
}
