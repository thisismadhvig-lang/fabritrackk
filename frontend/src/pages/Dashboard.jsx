import { useEffect, useState } from "react";
import { api, fmtKg, fmtNum, fmtMoney, STAGE_LABEL, STAGES } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  CartesianGrid,
  Legend,
} from "recharts";
import {
  Layers,
  TrendingUp,
  AlertTriangle,
  Package,
  Ruler,
  ArrowDownRight,
  Truck,
  Clock,
  Warehouse,
  Building2,
  Globe,
  CheckCircle2,
} from "lucide-react";

const KpiCard = ({ label, value, sub, tone = "slate", icon: Icon, testid }) => {
  const toneMap = {
    slate: "border-l-slate-900",
    green: "border-l-emerald-500",
    amber: "border-l-amber-500",
    red: "border-l-red-500",
    blue: "border-l-blue-500",
  };
  return (
    <Card
      data-testid={testid}
      className={`p-5 rounded-md shadow-sm border border-slate-200 border-l-4 ${toneMap[tone]} bg-white`}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="label-caps">{label}</div>
          <div className="kpi-num text-3xl mt-2">{value}</div>
          {sub && <div className="text-xs text-slate-500 mt-1.5">{sub}</div>}
        </div>
        {Icon && (
          <div className="h-9 w-9 rounded-sm bg-slate-100 flex items-center justify-center">
            <Icon className="h-4 w-4 text-slate-700" strokeWidth={2} />
          </div>
        )}
      </div>
    </Card>
  );
};

const COLORS = ["#0F172A", "#3B82F6", "#22C55E", "#EAB308", "#EF4444", "#8B5CF6", "#06B6D4"];
const TOOLTIP_STYLE = { border: "1px solid #E2E8F0", borderRadius: 6, fontSize: 12 };
const AXIS_TICK = { fontSize: 11, fill: "#64748B" };
const AXIS_TICK_SMALL = { fontSize: 10, fill: "#64748B" };
const LEGEND_STYLE = { fontSize: 11 };

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [ext, setExt] = useState(null);

  const load = async () => {
    const [s, e] = await Promise.all([
      api.get("/dashboard/summary"),
      api.get("/dashboard/extended"),
    ]);
    setData(s.data);
    setExt(e.data);
  };

  useEffect(() => {
    load();
  }, []);

  if (!data || !ext) {
    return (
      <div data-testid="dashboard-loading" className="text-slate-500 text-sm">
        Loading dashboard...
      </div>
    );
  }

  const k = data.kpi;

  return (
    <div data-testid="dashboard-page">
      <PageHeader
        title="Operations Dashboard"
        subtitle="Real-time fabric, production and quality metrics"
        testid="dashboard-header"
      />

      {/* Today's activity strip */}
      <div className="mb-6">
        <div className="label-caps mb-3">Today's Activity</div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <KpiCard
            label="Today's Production"
            value={fmtNum(ext.todays_production_pieces)}
            sub="Pieces returned today"
            icon={CheckCircle2}
            tone="green"
            testid="kpi-todays-production"
          />
          <KpiCard
            label="Today's Dispatch"
            value={fmtKg(ext.todays_dispatch_kg)}
            sub="Fabric sent to units"
            icon={Truck}
            tone="blue"
            testid="kpi-todays-dispatch"
          />
          <KpiCard
            label="Today's Receipts"
            value={fmtKg(ext.todays_receipt_kg)}
            sub="New fabric arrived"
            icon={ArrowDownRight}
            tone="slate"
            testid="kpi-todays-receipts"
          />
        </div>
      </div>

      {/* Operations KPIs */}
      <div className="mb-6">
        <div className="label-caps mb-3">Operational Snapshot</div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard label="Pending Orders" value={fmtNum(ext.pending_orders)} sub="Not shipped" icon={Clock} tone="amber" testid="kpi-pending-orders" />
          <KpiCard label="Delayed Orders" value={fmtNum(ext.delayed_orders)} sub="Past delivery date" icon={AlertTriangle} tone={ext.delayed_orders > 0 ? "red" : "slate"} testid="kpi-delayed-orders" />
          <KpiCard label="Warehouse Stock" value={fmtNum(ext.warehouse_stock_pieces)} sub="Finished pieces" icon={Warehouse} tone="green" testid="kpi-warehouse" />
          <KpiCard label="Fabric Available" value={fmtKg(ext.fabric_available_kg)} sub="In own warehouse" icon={Layers} tone="slate" testid="kpi-fabric-available" />
          <KpiCard label="Fabric at 3rd Party" value={fmtKg(ext.fabric_at_third_party_kg)} sub="Unaccounted at vendors" icon={Building2} tone="amber" testid="kpi-fabric-tp" />
          <KpiCard label="Efficiency" value={`${ext.efficiency_pct}%`} sub={`Defect ${ext.defect_pct}%`} icon={TrendingUp} tone={ext.efficiency_pct >= 95 ? "green" : ext.efficiency_pct >= 90 ? "amber" : "red"} testid="kpi-efficiency" />
        </div>
      </div>

      {/* Monthly revenue */}
      <div className="mb-6">
        <div className="label-caps mb-3">This Month</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <KpiCard label="Sales This Month" value={fmtMoney(ext.sales_this_month)} sub="All orders (local + export)" icon={TrendingUp} tone="green" testid="kpi-sales-month" />
          <KpiCard label="Export This Month" value={fmtMoney(ext.export_this_month)} sub="Export orders only" icon={Globe} tone="blue" testid="kpi-export-month" />
        </div>
      </div>

      <div className="label-caps mb-3">Cumulative Metrics</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard
          label="Fabric Received"
          value={fmtKg(k.total_kg_received)}
          sub="Total inward"
          icon={Layers}
          tone="slate"
          testid="kpi-fabric-received"
        />
        <KpiCard
          label="Fabric Dispatched"
          value={fmtKg(k.total_kg_dispatched)}
          sub="Sent to units / vendors"
          icon={ArrowDownRight}
          tone="blue"
          testid="kpi-fabric-dispatched"
        />
        <KpiCard
          label="Fabric Remaining"
          value={fmtKg(k.total_kg_remaining)}
          sub="In warehouse"
          icon={Layers}
          tone="green"
          testid="kpi-fabric-remaining"
        />
        <KpiCard
          label="Avg Fabric / Piece"
          value={`${(k.avg_fabric_per_piece_kg || 0).toFixed(3)} kg`}
          sub="Calculated from returns"
          icon={Ruler}
          tone="amber"
          testid="kpi-avg-fabric"
        />
        <KpiCard
          label="Pieces Received"
          value={fmtNum(k.total_pieces_received)}
          sub="Total from vendors"
          icon={Package}
          tone="slate"
          testid="kpi-pieces-received"
        />
        <KpiCard
          label="Pieces Defected"
          value={fmtNum(k.total_pieces_defected)}
          sub={`${k.defect_rate_pct}% defect rate`}
          icon={AlertTriangle}
          tone={k.defect_rate_pct > 5 ? "red" : "amber"}
          testid="kpi-pieces-defected"
        />
        <KpiCard
          label="Active Orders"
          value={fmtNum(k.total_orders)}
          sub="Across all stages"
          icon={TrendingUp}
          tone="blue"
          testid="kpi-orders"
        />
        <KpiCard
          label="Vendors"
          value={fmtNum(k.total_vendors)}
          sub="Own + 3rd party"
          icon={Package}
          tone="slate"
          testid="kpi-vendors"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <Card className="p-5 rounded-md shadow-sm border border-slate-200 bg-white">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-heading font-semibold text-slate-900">
              Fabric by Type
            </h3>
            <span className="label-caps">Kilograms</span>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data.fabric_by_type}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
              <XAxis dataKey="fabric_type" tick={AXIS_TICK} />
              <YAxis tick={AXIS_TICK} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="kg" fill="#0F172A" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          {data.fabric_by_type.length === 0 && (
            <div className="text-center text-xs text-slate-400 py-6">
              No fabric lots recorded yet
            </div>
          )}
        </Card>

        <Card className="p-5 rounded-md shadow-sm border border-slate-200 bg-white">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-heading font-semibold text-slate-900">
              Vendor Dispatch
            </h3>
            <span className="label-caps">Kg per vendor</span>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data.vendor_stats} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" horizontal={false} />
              <XAxis type="number" tick={AXIS_TICK} />
              <YAxis
                dataKey="vendor"
                type="category"
                tick={AXIS_TICK}
                width={90}
              />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="kg_dispatched" fill="#3B82F6" radius={[0, 2, 2, 0]} />
            </BarChart>
          </ResponsiveContainer>
          {data.vendor_stats.length === 0 && (
            <div className="text-center text-xs text-slate-400 py-6">
              No dispatches yet
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5 rounded-md shadow-sm border border-slate-200 bg-white lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-heading font-semibold text-slate-900">
              Production Stage Funnel
            </h3>
            <span className="label-caps">Orders per stage</span>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={data.stage_funnel.map(s => ({ ...s, label: STAGE_LABEL[s.stage] || s.stage }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
              <XAxis dataKey="label" tick={AXIS_TICK_SMALL} interval={0} angle={-30} textAnchor="end" height={70} />
              <YAxis tick={AXIS_TICK} allowDecimals={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="count" fill="#EAB308" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-5 rounded-md shadow-sm border border-slate-200 bg-white">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-heading font-semibold text-slate-900">
              Product Mix
            </h3>
            <span className="label-caps">Pieces</span>
          </div>
          {data.product_stats.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={data.product_stats}
                  dataKey="pieces_received"
                  nameKey="product"
                  innerRadius={50}
                  outerRadius={90}
                  paddingAngle={2}
                >
                  {data.product_stats.map((entry, i) => (
                    <Cell key={entry.product} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend wrapperStyle={LEGEND_STYLE} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-center text-xs text-slate-400 py-16">
              No production returns yet
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
