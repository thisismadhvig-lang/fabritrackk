import { useEffect, useState } from "react";
import { api, fmtKg, fmtNum, fmtMoney, fmtDate } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Layers,
  Scissors,
  Package,
  Ruler,
  AlertTriangle,
  Undo2,
  Coins,
  Warehouse,
  Clock,
} from "lucide-react";

const Stat = ({ label, value, sub, icon: Icon, tone = "slate", testid }) => {
  const toneMap = {
    slate: "border-l-slate-900",
    green: "border-l-emerald-500",
    amber: "border-l-amber-500",
    red: "border-l-red-500",
    blue: "border-l-blue-500",
    indigo: "border-l-indigo-500",
  };
  return (
    <Card
      data-testid={testid}
      className={`p-4 rounded-md shadow-sm border border-slate-200 border-l-4 ${toneMap[tone]} bg-white`}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="label-caps">{label}</div>
          <div className="kpi-num text-2xl mt-1.5">{value}</div>
          {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
        </div>
        {Icon && (
          <div className="h-8 w-8 rounded-sm bg-slate-100 flex items-center justify-center">
            <Icon className="h-4 w-4 text-slate-700" strokeWidth={2} />
          </div>
        )}
      </div>
    </Card>
  );
};

export default function Ledger() {
  const [vendors, setVendors] = useState([]);
  const [vendorId, setVendorId] = useState("");
  const [ledger, setLedger] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.get("/vendors").then((r) => {
      if (cancelled) return;
      setVendors(r.data);
      setVendorId((prev) => prev || (r.data[0]?.id ?? ""));
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!vendorId) return;
    let cancelled = false;
    api.get(`/vendors/${vendorId}/ledger`).then((r) => {
      if (!cancelled) setLedger(r.data);
    });
    return () => { cancelled = true; };
  }, [vendorId]);

  return (
    <div data-testid="ledger-page">
      <PageHeader
        title="Job Work Ledger"
        subtitle="Everything you've sent to a factory and what came back"
        actions={
          <Select value={vendorId} onValueChange={setVendorId}>
            <SelectTrigger data-testid="ledger-vendor-select" className="w-64">
              <SelectValue placeholder="Select vendor" />
            </SelectTrigger>
            <SelectContent>
              {vendors.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.name} ({v.type === "own" ? "Own" : "3rd Party"})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      {vendors.length === 0 && (
        <Card className="p-10 text-center text-slate-400 rounded-md border border-slate-200 bg-white">
          Add a vendor to open its job work ledger.
        </Card>
      )}

      {ledger && (
        <>
          <div className="flex items-center gap-3 mb-5">
            <div>
              <div className="label-caps">Factory / Unit</div>
              <div className="font-heading font-bold text-xl text-slate-900">
                {ledger.vendor.name}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                {ledger.vendor.location || "—"} · {ledger.vendor.contact || "—"}
              </div>
            </div>
            <Badge className={ledger.vendor.type === "own" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"}>
              {ledger.vendor.type === "own" ? "Own Factory" : "Third Party"}
            </Badge>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
            <Stat testid="ledger-fabric-received" label="Fabric Received" value={fmtKg(ledger.summary.total_fabric_received_kg)} sub="Total sent to this factory" icon={Layers} />
            <Stat testid="ledger-fabric-consumed" label="Fabric Consumed" value={fmtKg(ledger.summary.total_fabric_consumed_kg)} sub="Went into finished pieces" icon={Scissors} tone="blue" />
            <Stat testid="ledger-fabric-lying" label="Fabric Lying" value={fmtKg(ledger.summary.fabric_lying_with_factory_kg)} sub="Still at this factory" icon={Warehouse} tone={ledger.summary.fabric_lying_with_factory_kg > 0 ? "amber" : "green"} />
            <Stat testid="ledger-pieces-produced" label="Pieces Produced" value={fmtNum(ledger.summary.total_pieces_produced)} sub={`${fmtNum(ledger.summary.total_defected_pieces)} defected`} icon={Package} tone="green" />
            <Stat testid="ledger-avg-kg" label="Avg Kg / Piece" value={`${ledger.summary.avg_fabric_per_piece_kg.toFixed(3)} kg`} sub="From actual returns" icon={Ruler} tone="indigo" />
            <Stat testid="ledger-pending" label="Pieces Pending" value={fmtNum(ledger.summary.pieces_pending_return)} sub="Not yet returned" icon={Clock} tone={ledger.summary.pieces_pending_return > 0 ? "amber" : "slate"} />
            <Stat testid="ledger-defected" label="Defective Pieces" value={fmtNum(ledger.summary.total_defected_pieces)} sub="From quality check" icon={AlertTriangle} tone={ledger.summary.total_defected_pieces > 0 ? "red" : "slate"} />
            <Stat testid="ledger-returned" label="Fabric Returned" value={fmtKg(ledger.summary.total_fabric_returned_kg)} sub="Unused fabric back" icon={Undo2} />
            <Stat testid="ledger-waste" label="Cutting Waste" value={fmtKg(ledger.summary.total_cutting_waste_kg)} sub="Recorded waste kg" icon={Scissors} tone="amber" />
            <Stat testid="ledger-payable" label="Job Work Payable" value={fmtMoney(ledger.summary.job_work_charges_payable)} sub="₹ due to this factory" icon={Coins} tone="green" />
          </div>

          <Card className="rounded-md shadow-sm border border-slate-200 bg-white overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-heading font-semibold text-slate-900">Transaction History</h3>
              <span className="label-caps">{ledger.transactions.length} entries</span>
            </div>
            <Table data-testid="ledger-transactions">
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Kg</TableHead>
                  <TableHead className="text-right">Pieces</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ledger.transactions.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-slate-400 py-8">No transactions yet</TableCell></TableRow>
                )}
                {ledger.transactions.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>{fmtDate(t.date)}</TableCell>
                    <TableCell>
                      <Badge className={t.type === "dispatch_out" ? "bg-blue-100 text-blue-700 hover:bg-blue-100" : "bg-emerald-100 text-emerald-700 hover:bg-emerald-100"}>
                        {t.type === "dispatch_out" ? "OUT · Fabric" : "IN · Return"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-slate-700">{t.description}</TableCell>
                    <TableCell className="text-right font-mono-plex">{t.kg ? fmtKg(t.kg) : "—"}</TableCell>
                    <TableCell className="text-right font-mono-plex">{t.pieces ? fmtNum(t.pieces) : "—"}</TableCell>
                    <TableCell className="text-right font-mono-plex">{t.amount ? fmtMoney(t.amount) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}
