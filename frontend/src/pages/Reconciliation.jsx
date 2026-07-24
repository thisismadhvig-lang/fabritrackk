import { useEffect, useMemo, useState } from "react";
import { api, fmtKg, fmtNum, fmtMoney, STAGE_LABEL } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowDownRight,
  Scissors,
  Undo2,
  AlertTriangle,
  Package,
  Ruler,
  Coins,
  TrendingUp,
  DollarSign,
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

export default function Reconciliation() {
  const [orders, setOrders] = useState([]);
  const [buyers, setBuyers] = useState([]);
  const [products, setProducts] = useState([]);
  const [orderId, setOrderId] = useState("");
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.get("/orders"), api.get("/buyers"), api.get("/product-types")]).then(([o, b, p]) => {
      if (cancelled) return;
      setOrders(o.data);
      setBuyers(b.data);
      setProducts(p.data);
      setOrderId((prev) => prev || (o.data[0]?.id ?? ""));
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;
    api.get(`/orders/${orderId}/reconciliation`).then((r) => {
      if (!cancelled) setData(r.data);
    });
    return () => { cancelled = true; };
  }, [orderId]);

  const bMap = useMemo(() => Object.fromEntries(buyers.map((b) => [b.id, b])), [buyers]);
  const pMap = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products]);

  return (
    <div data-testid="reconciliation-page">
      <PageHeader
        title="Fabric Reconciliation"
        subtitle="Track every kilogram from dispatch to finished piece — spot leakage before it hurts"
        actions={
          <Select value={orderId} onValueChange={setOrderId}>
            <SelectTrigger data-testid="recon-order-select" className="w-72">
              <SelectValue placeholder="Select order" />
            </SelectTrigger>
            <SelectContent>
              {orders.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.order_number} · {pMap[o.product_type_id]?.name || "—"} · qty {o.quantity}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      {orders.length === 0 && (
        <Card className="p-10 text-center text-slate-400 rounded-md border border-slate-200 bg-white">
          Create an order to run a reconciliation on it.
        </Card>
      )}

      {data && (
        <>
          <Card className="p-5 mb-5 rounded-md shadow-sm border border-slate-200 bg-white">
            <div className="flex items-start justify-between flex-wrap gap-3">
              <div>
                <div className="label-caps">Order</div>
                <div className="font-heading font-bold text-2xl text-slate-900">
                  {data.order.order_number}
                </div>
                <div className="text-sm text-slate-500 mt-1">
                  {bMap[data.order.buyer_id]?.name || "—"} · {pMap[data.order.product_type_id]?.name || "—"} · Qty {data.order.quantity}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">{STAGE_LABEL[data.order.stage]}</Badge>
                <Badge className="bg-slate-900 text-white hover:bg-slate-900">₹{data.order.unit_price}/pc</Badge>
              </div>
            </div>
          </Card>

          <div className="label-caps mb-3">Fabric Flow</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <Stat testid="recon-issued" label="Fabric Issued" value={fmtKg(data.reconciliation.fabric_issued_kg)} sub="Dispatched for this order" icon={ArrowDownRight} tone="blue" />
            <Stat testid="recon-consumed" label="Fabric Consumed" value={fmtKg(data.reconciliation.fabric_consumed_kg)} sub="Went into finished pieces" icon={Scissors} tone="green" />
            <Stat testid="recon-returned" label="Fabric Returned Unused" value={fmtKg(data.reconciliation.fabric_returned_unused_kg)} sub="Back to warehouse" icon={Undo2} />
            <Stat testid="recon-waste" label="Cutting Waste" value={fmtKg(data.reconciliation.cutting_waste_kg)} sub="Recorded waste" icon={Scissors} tone="amber" />
            <Stat testid="recon-unaccounted" label="Unaccounted Loss" value={fmtKg(data.reconciliation.unaccounted_loss_kg)} sub="Issued − Consumed − Returned − Waste" icon={AlertTriangle} tone={data.reconciliation.unaccounted_loss_kg > 0.5 ? "red" : "slate"} />
            <Stat testid="recon-pieces" label="Finished Pieces" value={fmtNum(data.reconciliation.finished_pieces)} sub={`${data.reconciliation.defected_pieces} defected`} icon={Package} tone="green" />
            <Stat testid="recon-avg" label="Actual Avg Kg / Piece" value={`${data.reconciliation.avg_kg_per_piece.toFixed(3)} kg`} sub="Consumed ÷ Pieces" icon={Ruler} tone="indigo" />
            <Stat testid="recon-order-progress" label="Order Progress" value={`${Math.round((data.reconciliation.finished_pieces / (data.order.quantity || 1)) * 100)}%`} sub={`${data.reconciliation.finished_pieces} / ${data.order.quantity}`} icon={TrendingUp} tone="blue" />
          </div>

          <div className="label-caps mb-3">Piece Cost Calculator</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <Stat testid="cost-fabric-rate" label="Avg Fabric Rate" value={fmtMoney(data.costing.avg_fabric_cost_per_kg)} sub="₹ per kg (weighted)" icon={Coins} />
            <Stat testid="cost-fabric-used" label="Fabric Cost Used" value={fmtMoney(data.costing.fabric_cost_used)} sub="Consumed × avg rate" icon={Scissors} tone="blue" />
            <Stat testid="cost-jobwork" label="Job Work Cost" value={fmtMoney(data.costing.job_work_cost)} sub="Pieces × rate/pc" icon={Coins} tone="amber" />
            <Stat testid="cost-total" label="Total Production Cost" value={fmtMoney(data.costing.total_production_cost)} sub="Fabric + Job work" icon={DollarSign} tone="slate" />
            <Stat testid="cost-per-piece" label="Cost per Piece" value={fmtMoney(data.costing.cost_per_piece)} sub="Total ÷ finished pieces" icon={Package} tone="indigo" />
            <Stat testid="cost-unit-price" label="Selling Price" value={fmtMoney(data.costing.unit_price)} sub="Per piece" icon={DollarSign} />
            <Stat testid="cost-margin" label="Margin per Piece" value={fmtMoney(data.costing.margin_per_piece)} sub="Sell − Cost" icon={TrendingUp} tone={data.costing.margin_per_piece > 0 ? "green" : "red"} />
            <Stat testid="cost-revenue" label="Expected Revenue" value={fmtMoney(data.costing.expected_revenue)} sub="Order qty × price" icon={DollarSign} tone="green" />
          </div>

          {data.reconciliation.unaccounted_loss_kg > 0.5 && (
            <Card className="p-4 rounded-md border-l-4 border-l-red-500 border border-red-200 bg-red-50">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5" />
                <div>
                  <div className="font-medium text-red-800">Unaccounted fabric loss detected</div>
                  <div className="text-sm text-red-700 mt-1">
                    {fmtKg(data.reconciliation.unaccounted_loss_kg)} of fabric issued for this order is not reflected in consumption, returns, or cutting waste. This is a common source of profit leakage — investigate the vendor and worksheets.
                  </div>
                </div>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
