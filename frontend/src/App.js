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
          <Route path="/buyers" element={<Buyers />} />
          <Route path="/vendors" element={<Vendors />} />
          <Route path="/products" element={<ProductTypes />} />
          <Route path="/ledger" element={<Ledger />} />
          <Route path="/reconciliation" element={<Reconciliation />} />
          <Route path="/settings" element={<Settings />} />
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
