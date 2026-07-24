import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

// Axios instance with cookie credentials — token lives in httpOnly cookie set by backend
export const api = axios.create({
  baseURL: API,
  headers: { "Content-Type": "application/json" },
  withCredentials: true,
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
