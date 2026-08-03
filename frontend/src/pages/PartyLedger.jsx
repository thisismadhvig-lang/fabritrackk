import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api, fmtDate, fmtMoney } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowUpRight, Download, RefreshCcw, Search, Sparkles, Wallet2, ReceiptText, TrendingDown, TrendingUp } from "lucide-react";
import UniversalPrintButton from "@/components/erp/UniversalPrintButton";

const PARTY_TYPES = [
  { value: "Vendor", label: "Vendor" },
  { value: "Supplier", label: "Supplier" },
  { value: "Customer", label: "Customer" },
];

const DEFAULT_FILTERS = {
  search: "",
  dateFrom: "",
  dateTo: "",
  module: "all",
};

function buildReferenceRoute(entry) {
  const sourceType = String(entry?.source_type || "").toLowerCase();
  const sourceId = entry?.source_id;

  if (sourceType === "material_inventory" && sourceId) {
    return `/material-inventory?id=${encodeURIComponent(sourceId)}`;
  }
  if (sourceType === "material_dispatch" && sourceId) {
    return `/material-dispatch?id=${encodeURIComponent(sourceId)}`;
  }
  if (sourceType === "fabric_dispatch" && sourceId) {
    return `/dispatch?id=${encodeURIComponent(sourceId)}`;
  }
  if (sourceType === "fabric_lot" && sourceId) {
    return `/fabric?id=${encodeURIComponent(sourceId)}`;
  }
  if (sourceType === "payable" && sourceId) {
    return `/payments/payables?id=${encodeURIComponent(sourceId)}`;
  }
  if (sourceType === "receivable" && sourceId) {
    return `/payments/receivables?id=${encodeURIComponent(sourceId)}`;
  }
  if (sourceType === "payment_transaction" && sourceId) {
    return `/payments/transactions?id=${encodeURIComponent(sourceId)}`;
  }

  const moduleName = String(entry?.module_name || "").toLowerCase();
  if (moduleName.includes("fabric")) return "/dispatch";
  if (moduleName.includes("material")) return "/material-dispatch";
  if (moduleName.includes("receivable")) return "/payments/receivables";
  if (moduleName.includes("payable") || moduleName.includes("adjustment")) return "/payments/payables";
  if (moduleName.includes("transaction")) return "/payments/transactions";
  return null;
}

function SummaryCard({ label, value, tone = "default", icon: Icon }) {
  const tones = {
    positive: "bg-emerald-50 text-emerald-700",
    negative: "bg-rose-50 text-rose-700",
    default: "bg-slate-100 text-slate-700",
    purple: "bg-violet-50 text-violet-700",
  };

  return (
    <div className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">{label}</div>
          <div className={`mt-2 inline-flex rounded-full px-3 py-1 text-sm font-semibold ${tones[tone]}`}>{value}</div>
        </div>
        {Icon ? <div className="rounded-xl bg-slate-50 p-2"><Icon className="h-4 w-4" /></div> : null}
      </div>
    </div>
  );
}

function getPartyTone(type) {
  if (type === "Supplier") return "bg-indigo-50 text-indigo-700";
  if (type === "Customer") return "bg-emerald-50 text-emerald-700";
  return "bg-slate-100 text-slate-700";
}

function getModuleTone(moduleName) {
  const name = String(moduleName || "").toLowerCase();
  if (name.includes("payment") || name.includes("transaction")) return "bg-amber-50 text-amber-700";
  if (name.includes("receivable") || name.includes("payable")) return "bg-violet-50 text-violet-700";
  if (name.includes("fabric")) return "bg-sky-50 text-sky-700";
  if (name.includes("material")) return "bg-cyan-50 text-cyan-700";
  if (name.includes("opening")) return "bg-slate-100 text-slate-700";
  return "bg-slate-100 text-slate-700";
}

function getBalanceTone(amount) {
  const value = Number(amount || 0);
  if (value > 0) return "text-emerald-600";
  if (value < 0) return "text-rose-600";
  return "text-slate-700";
}

function formatReference(entry) {
  const reference = entry?.reference_no || "Entry";
  const sourceLabel = String(entry?.source_type || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

  return {
    reference,
    sourceLabel: sourceLabel || "Manual entry",
  };
}

function getDrCr(entry) {
  const debit = Number(entry?.debit || 0);
  const credit = Number(entry?.credit || 0);
  if (debit > credit) return "Dr";
  if (credit > debit) return "Cr";
  return "—";
}

function getEntryType(entry) {
  return entry?.transaction_type || entry?.module_name || "Entry";
}

function getEntryMode(entry) {
  const source = String(entry?.source_type || "").toLowerCase();
  const moduleName = String(entry?.module_name || "").toLowerCase();
  if (source.includes("payment") || moduleName.includes("payment") || moduleName.includes("transaction")) return "Payment";
  if (moduleName.includes("opening")) return "Opening";
  return "Journal";
}

export default function PartyLedger() {
  const navigate = useNavigate();
  const [parties, setParties] = useState([]);
  const [partyType, setPartyType] = useState("Vendor");
  const [partyId, setPartyId] = useState("");
  const [ledger, setLedger] = useState(null);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [selectedPrintIds, setSelectedPrintIds] = useState([]);

  const seedDemoData = useCallback(async () => {
    try {
      setSeeding(true);
      const existingResponse = await api.get("/parties", { params: { include_archived: true } });
      const existing = existingResponse.data || [];
      const existingNames = new Set((existing || []).map((item) => String(item.name || "").toLowerCase()));

      const ensureParty = async (name, type, openingBalance) => {
        if (existingNames.has(name.toLowerCase())) {
          return null;
        }
        return api.post("/parties", { name, party_type: type, opening_balance: openingBalance, remarks: `${type} demo party` });
      };

      const vendorParty = await ensureParty("Kumar Garments", "Vendor", 1000);
      const supplierParty = await ensureParty("Apex Mills", "Supplier", 500);
      const customerParty = await ensureParty("Bright Stitch", "Customer", 750);

      if (vendorParty) {
        const vendorResponse = await api.post("/vendors", { name: "Kumar Garments", type: "third_party", contact: "Kumar", location: "Delhi" });
        const lot = await api.post("/fabric-lots", {
          fabric_type: "Cotton",
          color: "Blue",
          supplier: "Kumar Garments",
          kg_received: 50,
          cost_per_kg: 10,
          date_received: "2026-01-01",
          notes: "Demo purchase",
        });
        await api.post("/fabric-dispatches", {
          fabric_lot_id: lot.data.id,
          vendor_id: vendorResponse.data.id,
          order_id: "demo-order",
          product_type_id: "demo-product-type",
          kg_dispatched: 12,
          date: "2026-01-02",
          notes: '{"dispatchNo": "FD-DEMO-100"}',
        });
      }

      if (customerParty) {
        await api.post("/receivables", {
          customer: "Bright Stitch",
          invoice_no: "INV-DEMO-1001",
          total_amount: 250,
          received_amount: 0,
          due_date: "2026-01-15",
          notes: "Demo receivable",
        });
      }

      if (supplierParty) {
        await api.post("/material-inventory", {
          date: "2026-01-03",
          material_name: "Interlining",
          supplier: "Apex Mills",
          quantity: 25,
          unit: "kg",
          rate: 8,
          notes: "Demo material purchase",
        });
      }
    } catch (error) {
      console.error(error);
    } finally {
      setSeeding(false);
    }
  }, []);

  const loadParties = useCallback(async () => {
    try {
      const response = await api.get("/parties", { params: { include_archived: true } });
      const list = response.data || [];
      const typed = list.filter((item) => item.party_type && PARTY_TYPES.some((type) => type.value === item.party_type));
      setParties(typed);
      const selectedTypeItems = typed.filter((item) => item.party_type === partyType);
      if (!selectedTypeItems.some((item) => item.id === partyId)) {
        setPartyId(selectedTypeItems[0]?.id || "");
      }
    } catch (error) {
      console.error(error);
    }
  }, [partyId, partyType]);

  useEffect(() => {
    loadParties();
  }, [loadParties]);

  useEffect(() => {
    const selectedItems = parties.filter((item) => item.party_type === partyType);
    if (!selectedItems.length) {
      setPartyId("");
      return;
    }
    setPartyId((currentPartyId) => (selectedItems.some((item) => item.id === currentPartyId) ? currentPartyId : selectedItems[0].id));
  }, [parties, partyType]);

  useEffect(() => {
    const fetchLedger = async () => {
      if (!partyId) {
        setLedger(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const response = await api.get("/party-ledger", {
          params: {
            party_type: partyType,
            party_id: partyId,
            search: filters.search || undefined,
            date_from: filters.dateFrom || undefined,
            date_to: filters.dateTo || undefined,
            module: filters.module === "all" ? undefined : filters.module,
          },
        });
        setLedger(response.data || null);
      } catch (error) {
        console.error(error);
        setLedger(null);
      } finally {
        setLoading(false);
      }
    };

    fetchLedger();
  }, [partyId, partyType, filters.search, filters.dateFrom, filters.dateTo, filters.module]);

  const partyOptions = useMemo(() => parties.filter((item) => item.party_type === partyType), [parties, partyType]);

  const moduleOptions = useMemo(() => {
    const modules = (ledger?.entries || []).map((entry) => entry.module_name).filter(Boolean);
    return Array.from(new Set(modules));
  }, [ledger]);

  const filteredEntries = useMemo(() => {
    const query = (filters.search || "").trim().toLowerCase();
    return (ledger?.entries || []).filter((entry) => {
      const matchesModule = filters.module === "all" || entry.module_name === filters.module;
      const matchesSearch = !query || [entry.reference_no, entry.description, entry.remarks, entry.module_name].join(" ").toLowerCase().includes(query);
      return matchesModule && matchesSearch;
    });
  }, [ledger, filters.module, filters.search]);

  const summary = ledger?.summary || {};
  const currentParty = ledger?.party || null;

  const handleReferenceClick = (entry) => {
    const route = buildReferenceRoute(entry);
    if (route) {
      navigate(route);
    }
  };

  const exportLedger = async () => {
    try {
      const response = await api.get("/export/party-ledger", {
        params: {
          party_type: partyType,
          party_id: partyId || undefined,
          module: filters.module === "all" ? undefined : filters.module,
          search: filters.search || undefined,
          date_from: filters.dateFrom || undefined,
          date_to: filters.dateTo || undefined,
        },
        responseType: "blob",
      });
      const blob = new Blob([response.data], { type: "application/vnd.openxmlformats-officedocument/spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `party_ledger_${(ledger?.party?.name || "export").toLowerCase().replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success("Excel exported");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Export failed");
    }
  };

  const printLedger = () => window.print();

  return (
    <div data-testid="party-ledger-page" className="space-y-4">
      <PageHeader
        title="Party Ledger"
        subtitle="Structured party balance history for vendors, suppliers and customers"
        testid="party-ledger-header"
        actions={
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={exportLedger} className="gap-2">
              <Download className="h-4 w-4" />
              Export Excel
            </Button>
            <UniversalPrintButton
              moduleName="Party Ledger"
              rows={filteredEntries.map((entry) => ({
                ...entry,
                dr_cr: getDrCr(entry),
                particulars: entry.reference_no || entry.description || "Entry",
                type: getEntryType(entry),
                mode: getEntryMode(entry),
              }))}
              columns={[
                { key: "entry_date", label: "Date" },
                { key: "dr_cr", label: "Dr / Cr" },
                { key: "particulars", label: "Particulars" },
                { key: "remarks", label: "Narration" },
                { key: "type", label: "Type" },
                { key: "mode", label: "Mode" },
                { key: "debit", label: "Debit" },
                { key: "credit", label: "Credit" },
                { key: "running_balance", label: "Balance" },
              ]}
              summary={[{ label: "Closing Balance", value: fmtMoney(summary.current_balance || 0) }]}
              reportTitle="Party Ledger"
              reportPeriod={`${currentParty?.name || "Party"} Ledger`}
              selectedRows={filteredEntries.filter((entry) => selectedPrintIds.includes(entry.id))}
              filteredRows={filteredEntries}
              allRows={ledger?.entries || []}
              selectedIds={selectedPrintIds}
              onSelectedIdsChange={setSelectedPrintIds}
            />
            <Button type="button" variant="outline" onClick={() => loadParties()} disabled={seeding} className="gap-2">
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
        }
      />

      <Card className="rounded-[24px] border border-slate-200 bg-gradient-to-br from-violet-50 via-white to-slate-50 p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="rounded-2xl bg-violet-600 p-2 text-white"><Sparkles className="h-4 w-4" /></div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">Accounts Ledger</div>
              <div className="text-lg font-semibold text-slate-900">Tally-style party ledger</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {PARTY_TYPES.map((option) => (
              <Button
                key={option.value}
                type="button"
                variant={partyType === option.value ? "default" : "outline"}
                size="sm"
                onClick={() => setPartyType(option.value)}
                className={partyType === option.value ? "bg-violet-600 text-white hover:bg-violet-700" : "border-slate-200 bg-white text-slate-700"}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <div className="rounded-[20px] border border-slate-200 bg-white p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">Selected party</div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold text-slate-900">{currentParty?.name || "Select a party"}</h3>
              {currentParty?.party_type ? <Badge className={getPartyTone(currentParty.party_type)}>{currentParty.party_type}</Badge> : null}
            </div>
            <p className="mt-2 text-sm text-slate-600">
              {currentParty?.remarks || "Ledger activity is grouped here with the latest balance and transaction references."}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-[18px] border border-slate-200 bg-white p-3 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">Opening</div>
              <div className="mt-2 text-base font-semibold text-slate-900">{fmtMoney(currentParty?.opening_balance || 0)}</div>
            </div>
            <div className="rounded-[18px] border border-slate-200 bg-white p-3 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">Current</div>
              <div className={`mt-2 text-base font-semibold ${getBalanceTone(summary.current_balance || 0)}`}>{fmtMoney(summary.current_balance || 0)}</div>
            </div>
            <div className="rounded-[18px] border border-slate-200 bg-white p-3 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">Last txn</div>
              <div className="mt-2 text-base font-semibold text-slate-900">{summary.last_transaction_date ? fmtDate(summary.last_transaction_date) : "—"}</div>
            </div>
          </div>
        </div>
      </Card>

      <Card className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-4 xl:grid-cols-5">
          <div>
            <label className="mb-1 flex text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Party</label>
            <Select value={partyId} onValueChange={setPartyId}>
              <SelectTrigger data-testid="party-ledger-party-select" className="w-full">
                <SelectValue placeholder="Select party" />
              </SelectTrigger>
              <SelectContent>
                {partyOptions.map((party) => (
                  <SelectItem key={party.id} value={party.id}>
                    {party.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
            <label className="mb-1 flex text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Module</label>
            <Select value={filters.module} onValueChange={(value) => setFilters((prev) => ({ ...prev, module: value }))}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Modules</SelectItem>
                {moduleOptions.map((module) => (
                  <SelectItem key={module} value={module}>
                    {module}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="lg:col-span-4">
            <label className="mb-1 flex text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Search</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={filters.search}
                onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
                placeholder="Reference / Description / Remarks"
                className="pl-9"
              />
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <SummaryCard label="Opening Balance" value={fmtMoney(currentParty?.opening_balance || 0)} tone="purple" icon={Wallet2} />
        <SummaryCard label="Total Debit" value={fmtMoney(summary.total_debit || 0)} icon={TrendingDown} />
        <SummaryCard label="Total Credit" value={fmtMoney(summary.total_credit || 0)} icon={TrendingUp} />
        <SummaryCard label="Closing Balance" value={fmtMoney(summary.current_balance || 0)} tone={Number(summary.current_balance || 0) >= 0 ? "positive" : "negative"} icon={ReceiptText} />
        <SummaryCard label="Outstanding" value={fmtMoney(summary.current_outstanding || 0)} tone={Number(summary.current_outstanding || 0) >= 0 ? "positive" : "negative"} icon={Wallet2} />
      </div>

      <Card className="overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div className="px-6 py-12 text-center text-sm text-slate-500">Loading party ledger…</div>
        ) : !partyId ? (
          <div className="px-6 py-12 text-center text-sm text-slate-500">Select a party to view its transaction history.</div>
        ) : filteredEntries.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-slate-500">No ledger entries match the current filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0 text-sm">
              <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">
                <tr>
                  <th className="border-b border-slate-200 px-3 py-3">Date</th>
                  <th className="border-b border-slate-200 px-3 py-3">Dr / Cr</th>
                  <th className="border-b border-slate-200 px-3 py-3">Particulars</th>
                  <th className="border-b border-slate-200 px-3 py-3">Narration</th>
                  <th className="border-b border-slate-200 px-3 py-3">Type</th>
                  <th className="border-b border-slate-200 px-3 py-3">Mode</th>
                  <th className="border-b border-slate-200 px-3 py-3">Debit</th>
                  <th className="border-b border-slate-200 px-3 py-3">Credit</th>
                  <th className="border-b border-slate-200 px-3 py-3">Balance</th>
                </tr>
              </thead>
              <tbody>
                {filteredEntries.map((entry) => {
                  const referenceInfo = formatReference(entry);
                  return (
                    <tr key={entry.id} className="odd:bg-white even:bg-slate-50/70">
                      <td className="px-3 py-3 align-top">
                        <span className="font-medium text-slate-900">{fmtDate(entry.entry_date)}</span>
                      </td>
                      <td className="px-3 py-3 align-top text-center">
                        <Badge className="bg-slate-100 text-slate-700">{getDrCr(entry)}</Badge>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <button
                          type="button"
                          onClick={() => handleReferenceClick(entry)}
                          className="inline-flex items-center gap-1 font-semibold text-blue-700 transition hover:text-blue-800"
                        >
                          <span>{referenceInfo.reference || "—"}</span>
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        </button>
                        <div className="mt-1 text-xs text-slate-500">{referenceInfo.sourceLabel}</div>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <div className="flex flex-col">
                          <span className="font-medium text-slate-900">{entry.remarks || "—"}</span>
                          <span className="mt-1 text-xs text-slate-500">{entry.description || "No description"}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <Badge className={getModuleTone(entry.module_name)}>{getEntryType(entry)}</Badge>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <Badge className="bg-white text-slate-600 ring-1 ring-slate-200">{getEntryMode(entry)}</Badge>
                      </td>
                      <td className="px-3 py-3 align-top text-right font-medium text-slate-700">{fmtMoney(entry.debit || 0)}</td>
                      <td className="px-3 py-3 align-top text-right font-medium text-slate-700">{fmtMoney(entry.credit || 0)}</td>
                      <td className={`px-3 py-3 align-top text-right font-semibold ${getBalanceTone(entry.running_balance || 0)}`}>{fmtMoney(entry.running_balance || 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
