import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, getStoredToken, setStoredToken } from "@/lib/api";

const AuthCtx = createContext(null);
const DEFAULT_SETTINGS = { app_name: "LOOMLINE", tagline: "Manufacturing ERP" };

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);

  const refreshSettings = useCallback(async () => {
    try {
      const res = await api.get("/settings");
      setSettings(res.data);
    } catch {
      /* ignore */
    }
  }, []);

  const login = useCallback(async (username, password) => {
    const res = await api.post("/auth/login", { username, password });
    const token = res.data.access_token;
    setStoredToken(token);
    setUser(res.data.user);
    return res.data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      /* ignore */
    }
    setStoredToken(null);
    setUser(null);
    window.location.href = "/login";
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await refreshSettings();
      const storedToken = getStoredToken();
      if (!storedToken) {
        if (!cancelled) setUser(null);
        if (!cancelled) setChecking(false);
        return;
      }
      try {
        const r = await api.get("/auth/me");
        if (!cancelled) setUser(r.data);
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshSettings]);

  const value = useMemo(
    () => ({ user, checking, settings, login, logout, refreshSettings }),
    [user, checking, settings, login, logout, refreshSettings]
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
