import { useEffect, useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Shirt, LogIn, Lock, User as UserIcon } from "lucide-react";

export default function Login() {
  const { user, login, checking } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [appName, setAppName] = useState("LOOMLINE");
  const [tagline, setTagline] = useState("Manufacturing ERP");

  useEffect(() => {
    let cancelled = false;
    api.get("/settings").then((r) => {
      if (cancelled) return;
      setAppName(r.data.app_name || "LOOMLINE");
      setTagline(r.data.tagline || "Manufacturing ERP");
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (checking) return null;
  if (user) return <Navigate to="/" replace />;

  const submit = async (e) => {
    e.preventDefault();
    if (!username || !password) return toast.error("Enter username and password");
    setBusy(true);
    try {
      await login(username.trim(), password);
      toast.success("Welcome back");
      nav("/", { replace: true });
    } catch (err) {
      toast.error(err.response?.data?.detail || "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="login-page" className="min-h-screen flex bg-slate-50">
      {/* Left: brand panel */}
      <div className="hidden lg:flex lg:w-[45%] bg-slate-950 text-white flex-col justify-between p-12 relative overflow-hidden">
        <div className="industrial-grid absolute inset-0 opacity-20" />
        <div className="relative z-10">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-sm bg-amber-400 flex items-center justify-center">
              <Shirt className="h-5 w-5 text-slate-950" strokeWidth={2.5} />
            </div>
            <div>
              <div className="font-heading font-bold text-xl leading-none">{appName}</div>
              <div className="label-caps text-slate-500 mt-1" style={{ color: "#94A3B8" }}>{tagline}</div>
            </div>
          </div>
        </div>
        <div className="relative z-10">
          <div className="label-caps text-amber-400 mb-3">WELCOME!</div>
          <h1 className="font-heading text-5xl xl:text-6xl font-bold tracking-tight leading-[1.05]">
            Let's get<br />back to work.
          </h1>
          <p className="text-slate-400 mt-6 max-w-md text-sm leading-relaxed">
            Every kilogram of fabric, every finished piece, every order — from cutting floor to shipment.
            Track it, own it, ship it.
          </p>
        </div>
        <div className="relative z-10 grid grid-cols-3 gap-4 text-slate-400">
          <div>
            <div className="kpi-num text-3xl text-white">14</div>
            <div className="label-caps mt-1" style={{ color: "#64748B" }}>Stage Pipeline</div>
          </div>
          <div>
            <div className="kpi-num text-3xl text-white">KG</div>
            <div className="label-caps mt-1" style={{ color: "#64748B" }}>Precision Tracking</div>
          </div>
          <div>
            <div className="kpi-num text-3xl text-white">₹</div>
            <div className="label-caps mt-1" style={{ color: "#64748B" }}>Piece Cost</div>
          </div>
        </div>
      </div>

      {/* Right: login form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-2 mb-6">
            <div className="h-9 w-9 rounded-sm bg-amber-400 flex items-center justify-center">
              <Shirt className="h-4 w-4 text-slate-950" strokeWidth={2.5} />
            </div>
            <div>
              <div className="font-heading font-bold text-lg">{appName}</div>
              <div className="label-caps" style={{ color: "#64748B" }}>{tagline}</div>
            </div>
          </div>

          <div className="mb-8">
            <div className="label-caps text-amber-600 mb-2">Sign In</div>
            <h2 data-testid="login-welcome" className="font-heading text-3xl font-bold text-slate-900 tracking-tight">
              WELCOME! LET'S GET BACK TO WORK
            </h2>
            <p className="text-sm text-slate-500 mt-2">
              Enter your credentials to enter the control room.
            </p>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label className="label-caps mb-2 block">Username</Label>
              <div className="relative">
                <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  data-testid="login-username"
                  className="pl-10 h-11"
                  placeholder="admin"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  autoFocus
                />
              </div>
            </div>
            <div>
              <Label className="label-caps mb-2 block">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  data-testid="login-password"
                  className="pl-10 h-11"
                  type="password"
                  placeholder="••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
            </div>

            <Button
              data-testid="login-submit"
              type="submit"
              disabled={busy}
              className="w-full h-11 bg-slate-900 hover:bg-slate-800 text-white font-medium"
            >
              <LogIn className="h-4 w-4 mr-2" />
              {busy ? "Signing in..." : "Sign In"}
            </Button>

            <div className="text-xs text-slate-500 pt-4 border-t border-slate-200 mt-6">
              Default credentials on first launch are <b>admin / admin</b>. Change them in <b>Settings</b> after login.
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
