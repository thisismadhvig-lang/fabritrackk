import axios from "axios";

const BACKEND_URL = (process.env.REACT_APP_BACKEND_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
export const API = `${BACKEND_URL}/api`;

const TOKEN_KEY = "fabritrack_token";

export const getStoredToken = () => {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
};

export const setStoredToken = (token) => {
  if (typeof window === "undefined") return;
  if (token) {
    window.localStorage.setItem(TOKEN_KEY, token);
  } else {
    window.localStorage.removeItem(TOKEN_KEY);
  }
};

// Axios instance with cookie credentials — token lives in httpOnly cookie set by backend
export const api = axios.create({
  baseURL: API,
  headers: { "Content-Type": "application/json" },
  withCredentials: true,
  timeout: 8000,
});

api.interceptors.request.use((config) => {
  const token = getStoredToken();
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// If any request returns 401, redirect to login (unless already on it)
api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      if (typeof window !== "undefined" && window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }
    return Promise.reject(err);
  }
);

export const STAGES = [
  "order_received",
  "sampling",
  "buyer_approval",
  "fabric_purchase",
  "fabric_received",
  "cutting",
  "printing",
  "stitching",
  "washing",
  "finishing",
  "quality_check",
  "packing",
  "warehouse",
  "shipment",
];

export const STAGE_LABEL = {
  order_received: "Order Received",
  sampling: "Sampling",
  buyer_approval: "Buyer Approval",
  fabric_purchase: "Fabric Purchase",
  fabric_received: "Fabric Received",
  cutting: "Cutting",
  printing: "Printing",
  stitching: "Stitching",
  washing: "Washing",
  finishing: "Finishing",
  quality_check: "Quality Check",
  packing: "Packing",
  warehouse: "Warehouse",
  shipment: "Shipment",
};

export const fmtMoney = (n) =>
  `₹${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const fmtKg = (n) => `${Number(n || 0).toFixed(2)} kg`;
export const fmtNum = (n) => Number(n || 0).toLocaleString();
export const fmtDate = (iso) => {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
  } catch {
    return "—";
  }
};
