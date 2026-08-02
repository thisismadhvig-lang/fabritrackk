import { NavLink } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import {
  LayoutDashboard,
  ClipboardList,
  Package,
  Truck,
  BookOpen,
  Boxes,
  Send,
  FileSpreadsheet,
  Factory,
  RotateCcw,
  Wallet,
  ArrowUpCircle,
  ArrowDownCircle,
  CreditCard,
  BarChart3,
  Building2,
  Users,
  Settings as SettingsIcon,
  SlidersHorizontal,
  LogOut,
} from "lucide-react";

const NAV = [
  { type: "item", to: "/", label: "Dashboard", icon: LayoutDashboard, testid: "nav-dashboard" },
  { type: "item", to: "/orders", label: "Orders", icon: ClipboardList, testid: "nav-orders" },

  { type: "section", label: "FABRIC" },
  { type: "item", to: "/fabric", label: "Fabric Purchase", icon: Package, testid: "nav-fabric" },
  { type: "item", to: "/dispatch", label: "Fabric Dispatch", icon: Truck, testid: "nav-dispatch" },
  { type: "item", to: "/ledger", label: "Production Ledger", icon: BookOpen, testid: "nav-ledger" },

  { type: "section", label: "MATERIALS" },
  { type: "item", to: "/material-inventory", label: "Material Inventory", icon: Boxes, testid: "nav-material-inventory" },
  { type: "item", to: "/material-dispatch", label: "Material Dispatch", icon: Send, testid: "nav-material-dispatch" },
  { type: "item", to: "/material-ledger", label: "Material Ledger", icon: FileSpreadsheet, testid: "nav-material-ledger" },
  { type: "item", to: "/party-ledger", label: "Accounts Ledger", icon: BookOpen, testid: "nav-party-ledger" },

  { type: "section", label: "PRODUCTION" },
  { type: "item", to: "/production", label: "Production Tracking", icon: Factory, testid: "nav-production" },
  { type: "item", to: "/production-traceability", label: "Production Traceability", icon: BookOpen, testid: "nav-production-traceability" },
  { type: "item", to: "/returns", label: "Returns & QC", icon: RotateCcw, testid: "nav-returns" },
  { type: "item", to: "/warehouse", label: "Warehouse", icon: Boxes, testid: "nav-warehouse" },
  { type: "item", to: "/shipments", label: "Shipment", icon: Send, testid: "nav-shipments" },

  { type: "section", label: "PAYMENTS" },
  { type: "item", to: "/payments", label: "Payments Dashboard", icon: Wallet, testid: "nav-payments-dashboard" },
  { type: "item", to: "/payments/payables", label: "Payables", icon: ArrowUpCircle, testid: "nav-payables" },
  { type: "item", to: "/payments/receivables", label: "Receivables", icon: ArrowDownCircle, testid: "nav-receivables" },
  { type: "item", to: "/payments/transactions", label: "Transactions", icon: CreditCard, testid: "nav-transactions" },

  { type: "item", to: "/reconciliation", label: "Reports", icon: BarChart3, testid: "nav-reconciliation" },
  { type: "item", to: "/vendors", label: "Suppliers / Vendors", icon: Building2, testid: "nav-vendors" },
  { type: "item", to: "/buyers", label: "Customers", icon: Users, testid: "nav-buyers" },
  { type: "item", to: "/settings", label: "Settings", icon: SettingsIcon, testid: "nav-settings" },
  { type: "item", to: "/customization", label: "Customization Studio", icon: SlidersHorizontal, testid: "nav-customization" },
];

export default function Sidebar() {
  const { logout } = useAuth();
  return (
    <aside
      data-testid="sidebar"
      className="fixed inset-y-0 left-0 z-30 w-[250px] bg-[#0B1220] text-white border-r border-white/10 flex flex-col"
    >
      <div className="px-5 py-5 border-b border-white/10">
        <div className="min-w-0">
          <div data-testid="sidebar-app-name" className="font-heading font-bold text-white text-[16px] leading-none tracking-wide truncate">
            FABRITRACK
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.16em] text-white/60">GARMENT ERP</div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-3">
        <div className="space-y-1">
          {NAV.map((item, idx) => {
            if (item.type === "section") {
              return (
                <div key={`${item.label}-${idx}`} className="pt-2">
                  <div className="my-2 border-t border-white/10" />
                  <div className="px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/45">{item.label}</div>
                </div>
              );
            }

            const Icon = item.icon;
            if (item.disabled || !item.to) {
              return (
                <button
                  key={item.label}
                  type="button"
                  data-testid={item.testid}
                  disabled
                  className="w-full flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-white/35 cursor-not-allowed"
                >
                  <Icon className="h-4 w-4 shrink-0" strokeWidth={2} />
                  <span className="truncate text-left">{item.label}</span>
                </button>
              );
            }

            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                data-testid={item.testid}
                className={({ isActive }) =>
                  `group flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-all duration-150 ${
                    isActive ? "bg-[#7C3AED] text-white shadow-sm" : "text-white/90 hover:bg-white/10 hover:text-white"
                  }`
                }
              >
                <Icon className="h-4 w-4 shrink-0" strokeWidth={2} />
                <span className="truncate">{item.label}</span>
              </NavLink>
            );
          })}
        </div>
      </nav>

      <div className="px-4 py-3 border-t border-white/10">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.12em] text-white/45">Signed in as</div>
            <div data-testid="sidebar-username" className="text-sm text-white font-medium truncate">
              Admin
            </div>
          </div>
          <button
            data-testid="logout-btn"
            onClick={logout}
            className="p-2 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors"
            title="Logout"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
