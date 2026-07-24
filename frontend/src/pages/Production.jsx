import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, STAGES, STAGE_LABEL } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, Circle } from "lucide-react";

const STAGE_TONE = {
  order_received: "bg-slate-100 text-slate-700",
  sampling: "bg-blue-100 text-blue-700",
  buyer_approval: "bg-purple-100 text-purple-700",
  fabric_purchase: "bg-indigo-100 text-indigo-700",
  fabric_received: "bg-cyan-100 text-cyan-700",
  cutting: "bg-amber-100 text-amber-800",
  printing: "bg-orange-100 text-orange-800",
  stitching: "bg-yellow-100 text-yellow-800",
  washing: "bg-sky-100 text-sky-800",
  finishing: "bg-teal-100 text-teal-800",
  quality_check: "bg-lime-100 text-lime-800",
  packing: "bg-emerald-100 text-emerald-700",
  warehouse: "bg-green-100 text-green-700",
  shipment: "bg-slate-900 text-white",
};

export default function Production() {
  const [orders, setOrders] = useState([]);
  const [buyers, setBuyers] = useState([]);
  const [products, setProducts] = useState([]);

  const load = async () => {
    const [o, b, p] = await Promise.all([
      api.get("/orders"),
      api.get("/buyers"),
      api.get("/product-types"),
    ]);
    setOrders(o.data);
    setBuyers(b.data);
    setProducts(p.data);
  };

  useEffect(() => { load(); }, []);

  const changeStage = async (id, stage) => {
    await api.patch(`/orders/${id}/stage`, { stage });
    toast.success(`Moved to ${STAGE_LABEL[stage]}`);
    load();
  };

  const buyerName = (id) => buyers.find(b => b.id === id)?.name || "—";
  const productName = (id) => products.find(p => p.id === id)?.name || "—";

  return (
    <div data-testid="production-page">
      <PageHeader
        title="Production Pipeline"
        subtitle="Track every order through the 14-stage manufacturing workflow"
      />

      {/* Legend / stages timeline */}
      <Card className="p-5 mb-6 rounded-md shadow-sm border border-slate-200 bg-white">
        <div className="label-caps mb-3">Manufacturing Flow</div>
        <div className="flex flex-wrap gap-1.5">
          {STAGES.map((s, i) => (
            <div key={s} className="flex items-center gap-1.5">
              <Badge className={`${STAGE_TONE[s]} font-medium hover:${STAGE_TONE[s]}`}>{STAGE_LABEL[s]}</Badge>
              {i < STAGES.length - 1 && <span className="text-slate-300 text-xs">›</span>}
            </div>
          ))}
        </div>
      </Card>

      {orders.length === 0 ? (
        <Card className="p-10 text-center text-slate-400 rounded-md border border-slate-200 bg-white">
          No orders yet. Create an order to start tracking production.
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {orders.map((o) => {
            const idx = STAGES.indexOf(o.stage);
            return (
              <Card key={o.id} data-testid={`production-order-${o.id}`} className="p-5 rounded-md shadow-sm border border-slate-200 bg-white">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="label-caps">Order</div>
                    <div className="font-heading font-bold text-lg text-slate-900">{o.order_number}</div>
                    <div className="text-sm text-slate-500 mt-1">
                      {buyerName(o.buyer_id)} · {productName(o.product_type_id)} · Qty {o.quantity}
                    </div>
                  </div>
                  <Badge className={`${STAGE_TONE[o.stage]} font-medium`}>{STAGE_LABEL[o.stage]}</Badge>
                </div>

                {/* Stage progress dots */}
                <div className="flex items-center gap-1 flex-wrap mb-4">
                  {STAGES.map((s, i) => (
                    <div key={s} className="stage-node flex items-center" title={STAGE_LABEL[s]}>
                      {i <= idx ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" strokeWidth={2.5} />
                      ) : (
                        <Circle className="h-4 w-4 text-slate-300" strokeWidth={2} />
                      )}
                      {i < STAGES.length - 1 && (
                        <div className={`h-0.5 w-3 ${i < idx ? "bg-emerald-500" : "bg-slate-200"}`} />
                      )}
                    </div>
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  <Select value={o.stage} onValueChange={(v) => changeStage(o.id, v)}>
                    <SelectTrigger data-testid={`stage-select-${o.id}`} className="flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STAGES.map((s) => (
                        <SelectItem key={s} value={s}>{STAGE_LABEL[s]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
