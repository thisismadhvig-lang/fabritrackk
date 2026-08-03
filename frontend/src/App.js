import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/lib/auth";
import Sidebar from "@/components/Sidebar";
import Dashboard from "@/pages/Dashboard";
import FabricInventory from "@/pages/FabricInventory";
import FabricDispatch from "@/pages/FabricDispatch";
import Production from "@/pages/Production";
import Returns from "@/pages/Returns";
import Orders from "@/pages/Orders";
import Buyers from "@/pages/Buyers";
import Vendors from "@/pages/Vendors";
import ProductTypes from "@/pages/ProductTypes";
import Ledger from "@/pages/Ledger";
import Reconciliation from "@/pages/Reconciliation";
import Login from "@/pages/Login";
import Settings from "@/pages/Settings";
import CustomizationStudio from "@/pages/CustomizationStudio";
import MaterialInventory from "@/pages/MaterialInventory";
import MaterialDispatch from "@/pages/MaterialDispatch";
import MaterialLedger from "@/pages/MaterialLedger";
import Payments from "@/pages/Payments";
import PartyLedger from "@/pages/PartyLedger";
import Warehouse from "@/pages/Warehouse";
import Shipments from "@/pages/Shipments";
import ProductionTraceability from "@/pages/ProductionTraceability";
import About from "./pages/About";

function Protected({ children }) {
  const { user, checking } = useAuth();
  const loc = useLocation();
  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500 text-sm">
        Loading...
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: loc }} />;
  return children;
}

function Shell() {
  return (
    <div className="min-h-screen bg-slate-50">
      <Sidebar />
      <main className="ml-60 p-6 sm:p-8">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/fabric" element={<FabricInventory />} />
          <Route path="/dispatch" element={<FabricDispatch />} />
          <Route path="/production" element={<Production />} />
          <Route path="/returns" element={<Returns />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/orders/:orderId" element={<Orders />} />
          <Route path="/buyers" element={<Buyers />} />
          <Route path="/vendors" element={<Vendors />} />
          <Route path="/products" element={<ProductTypes />} />
          <Route path="/ledger" element={<Ledger />} />
          <Route path="/material-inventory" element={<MaterialInventory />} />
          <Route path="/material-dispatch" element={<MaterialDispatch />} />
          <Route path="/material-ledger" element={<MaterialLedger />} />
          <Route path="/party-ledger" element={<PartyLedger />} />
          <Route path="/warehouse" element={<Warehouse />} />
          <Route path="/shipments" element={<Shipments />} />
          <Route path="/production-traceability" element={<ProductionTraceability />} />
          <Route path="/payments" element={<Payments module="dashboard" />} />
          <Route path="/payments/payables" element={<Payments module="payables" />} />
          <Route path="/payments/receivables" element={<Payments module="receivables" />} />
          <Route path="/payments/transactions" element={<Payments module="transactions" />} />
          <Route path="/reconciliation" element={<Reconciliation />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/about" element={<About />} />
          <Route path="/customization" element={<CustomizationStudio />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="/*"
              element={
                <Protected>
                  <Shell />
                </Protected>
              }
            />
          </Routes>
          <Toaster position="top-right" richColors />
        </AuthProvider>
      </BrowserRouter>
    </div>
  );
}

export default App;
