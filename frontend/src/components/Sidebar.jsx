import { NavLink } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import {
  LayoutDashboard,
  Package,
  Truck,
  Factory,
  ClipboardList,
  Users,
  Shirt,
  Warehouse,
  BookOpen,
  Scale,
  Settings as SettingsIcon,
  LogOut,
} from "lucide-react";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, testid: "nav-dashboard" },
  { to: "/fabric", label: "Fabric Inventory", icon: Warehouse, testid: "nav-fabric" },
  { to: "/dispatch", label: "Fabric Dispatch", icon: Truck, testid: "nav-dispatch" },
  { to: "/production", label: "Production", icon: Factory, testid: "nav-production" },
  { to: "/returns", label: "Returns & QC", icon: Package, testid: "nav-returns" },
  { to: "/orders", label: "Orders", icon: ClipboardList, testid: "nav-orders" },
  { to: "/ledger", label: "Job Work Ledger", icon: BookOpen, testid: "nav-ledger" },
  { to: "/reconciliation", label: "Reconciliation", icon: Scale, testid: "nav-reconciliation" },
  { to: "/buyers", label: "Buyers", icon: Users, testid: "nav-buyers" },
  { to: "/vendors", label: "Vendors", icon: Factory, testid: "nav-vendors" },
  { to: "/products", label: "Product Types", icon: Shirt, testid: "nav-products" },
  { to: "/settings", label: "Settings", icon: SettingsIcon, testid: "nav-settings" },
];

export default function Sidebar() {
  const { user, settings, logout } = useAuth();
  return (
    <aside
      data-testid="sidebar"
      className="w-60 bg-slate-950 text-slate-200 flex flex-col fixed inset-y-0 left-0 z-30"
    >
      <div className="px-5 py-5 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-sm bg-amber-400 flex items-center justify-center">
            <Shirt className="h-4 w-4 text-slate-950" strokeWidth={2.5} />
          </div>
          <div className="min-w-0 flex-1">
            <div data-testid="sidebar-app-name" className="font-heading font-bold text-white text-[15px] leading-none truncate">
              {settings.app_name}
            </div>
            <div className="label-caps mt-1 truncate" style={{ color: "#64748B" }}>
              {settings.tagline}
            </div>
          </div>
        </div>
      </div>

      <nav className="flex-1 py-3 overflow-y-auto">
        {NAV.map(({ to, label, icon: Icon, testid }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            data-testid={testid}
            className={({ isActive }) =>
              `flex items-center gap-3 px-5 py-2.5 text-sm border-l-2 transition-colors ${
                isActive
                  ? "bg-slate-900 text-white border-amber-400 font-medium"
                  : "text-slate-400 hover:text-white hover:bg-slate-900/50 border-transparent"
              }`
            }
          >
            <Icon className="h-4 w-4" strokeWidth={2} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="px-5 py-3 border-t border-slate-800 space-y-2">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <div className="label-caps mb-0.5" style={{ color: "#64748B" }}>Signed in as</div>
            <div data-testid="sidebar-username" className="text-sm text-white font-medium truncate">
              {user?.username || "—"}
            </div>
          </div>
          <button
            data-testid="logout-btn"
            onClick={logout}
            className="p-2 rounded-sm text-slate-400 hover:text-white hover:bg-slate-900 transition-colors"
            title="Logout"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
