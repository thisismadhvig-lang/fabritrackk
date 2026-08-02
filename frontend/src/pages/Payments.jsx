import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api, fmtDate, fmtMoney } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BadgeDollarSign,
  Banknote,
  CalendarRange,
  CircleDollarSign,
  Download,
  Eye,
  FileText,
  Filter,
  HandCoins,
  Pencil,
  Plus,
  ReceiptText,
  RefreshCcw,
  Trash2,
  Upload,
} from "lucide-react";

const pageSizeOptions = [10, 25, 50];
const paymentModes = ["Cash", "Bank", "UPI", "Cheque"];
const payableSources = ["Fabric Purchase", "Material Purchase", "Job Work"];
const payableMetricCards = [
  { key: "original_job_work_amount", label: "Original Job Work" },
  { key: "total_material_adjustment", label: "Material Adjustment" },
  { key: "net_payable_amount", label: "Net Payable" },
  { key: "outstanding_balance", label: "Outstanding" },
];

const emptyPayableForm = {
  vendor: "",
  reference_no: "",
  source: "Fabric Purchase",
  total_amount: "",
  paid_amount: "",
  due_date: "",
  notes: "",
};

const emptyReceivableForm = {
  customer: "",
  invoice_no: "",
  total_amount: "",
  received_amount: "",
  due_date: "",
  notes: "",
};

const emptyTransactionForm = {
  date: new Date().toISOString().slice(0, 10),
  transaction_type: "Payment Given",
  party: "",
  reference_no: "",
  payable_id: "",
  receivable_id: "",
  amount: "",
  payment_mode: "Cash",
  notes: "",
};

function formatStatus(status) {
  const map = {
    Paid: "bg-emerald-100 text-emerald-700",
    Partial: "bg-amber-100 text-amber-700",
    Pending: "bg-slate-100 text-slate-700",
    Overdue: "bg-red-100 text-red-700",
  };
  return map[status] || "bg-slate-100 text-slate-700";
}

function SectionHeader({ title, subtitle, actions }) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <div className="text-lg font-semibold text-slate-900">{title}</div>
        <div className="text-sm text-slate-500">{subtitle}</div>
      </div>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </div>
  );
}

function StatCard({ label, value, hint, tone = "default", icon: Icon }) {
  const toneClasses = {
    default: "border-slate-200 bg-white text-slate-700",
    positive: "border-emerald-200 bg-emerald-50 text-emerald-700",
    warning: "border-amber-200 bg-amber-50 text-amber-700",
    slate: "border-violet-200 bg-violet-50 text-violet-700",
  };

  return (
    <div className={`rounded-[20px] border p-4 shadow-sm ${toneClasses[tone] || toneClasses.default}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">{label}</div>
          <div className="mt-2 text-xl font-semibold">{value}</div>
          {hint ? <div className="mt-1 text-sm text-slate-500">{hint}</div> : null}
        </div>
        {Icon ? <div className="rounded-xl bg-white/70 p-2 shadow-sm"><Icon className="h-4 w-4" /></div> : null}
      </div>
    </div>
  );
}

export default function Payments({ module = "dashboard" }) {
  const [dashboard, setDashboard] = useState(null);
  const [payables, setPayables] = useState([]);
  const [receivables, setReceivables] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  const [payableDrawerOpen, setPayableDrawerOpen] = useState(false);
  const [receivableDrawerOpen, setReceivableDrawerOpen] = useState(false);
  const [transactionDrawerOpen, setTransactionDrawerOpen] = useState(false);
  const [editingPayable, setEditingPayable] = useState(null);
  const [editingReceivable, setEditingReceivable] = useState(null);
  const [editingTransaction, setEditingTransaction] = useState(null);
  const [payableForm, setPayableForm] = useState(emptyPayableForm);
  const [receivableForm, setReceivableForm] = useState(emptyReceivableForm);
  const [transactionForm, setTransactionForm] = useState(emptyTransactionForm);
  const [payableDeleteTarget, setPayableDeleteTarget] = useState(null);
  const [receivableDeleteTarget, setReceivableDeleteTarget] = useState(null);
  const [transactionDeleteTarget, setTransactionDeleteTarget] = useState(null);
  const [detailTarget, setDetailTarget] = useState(null);
  const [detailType, setDetailType] = useState("payable");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [vendorFilter, setVendorFilter] = useState("all");
  const [payableDateFrom, setPayableDateFrom] = useState("");
  const [payableDateTo, setPayableDateTo] = useState("");
  const [customerFilter, setCustomerFilter] = useState("all");
  const [receivableDateFrom, setReceivableDateFrom] = useState("");
  const [receivableDateTo, setReceivableDateTo] = useState("");
  const [transactionView, setTransactionView] = useState("all");
  const [transactionDateFrom, setTransactionDateFrom] = useState("");
  const [transactionDateTo, setTransactionDateTo] = useState("");
  const [transactionPartyFilter, setTransactionPartyFilter] = useState("");
  const [transactionVoucherFilter, setTransactionVoucherFilter] = useState("all");
  const [transactionModeFilter, setTransactionModeFilter] = useState("all");
  const [transactionModuleFilter, setTransactionModuleFilter] = useState("all");
  const [sortBy, setSortBy] = useState("date");
  const [sortDir, setSortDir] = useState("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [dashboardSearch, setDashboardSearch] = useState("");
  const [dashboardFrom, setDashboardFrom] = useState("");
  const [dashboardTo, setDashboardTo] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const payableImportRef = useRef(null);
  const receivableImportRef = useRef(null);
  const transactionImportRef = useRef(null);

  const loadDashboard = useCallback(async () => {
    try {
      const res = await api.get("/payments/dashboard");
      setDashboard(res.data || null);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to load payments dashboard");
    }
  }, []);

  const loadPayables = useCallback(async () => {
    try {
      const res = await api.get("/payables");
      setPayables(res.data || []);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to load payables");
    }
  }, []);

  const loadReceivables = useCallback(async () => {
    try {
      const res = await api.get("/receivables");
      setReceivables(res.data || []);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to load receivables");
    }
  }, []);

  const loadTransactions = useCallback(async () => {
    try {
      const res = await api.get("/payment-transactions");
      setTransactions(res.data || []);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to load transactions");
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([loadDashboard(), loadPayables(), loadReceivables(), loadTransactions()]);
    } finally {
      setLoading(false);
    }
  }, [loadDashboard, loadPayables, loadReceivables, loadTransactions]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, sourceFilter, vendorFilter, payableDateFrom, payableDateTo, customerFilter, receivableDateFrom, receivableDateTo, transactionView, transactionDateFrom, transactionDateTo, transactionPartyFilter, transactionVoucherFilter, transactionModeFilter, transactionModuleFilter, sortBy, sortDir, pageSize]);

  const openNewPayable = () => {
    setEditingPayable(null);
    setPayableForm({ ...emptyPayableForm, due_date: "" });
    setPayableDrawerOpen(true);
  };

  const openEditPayable = (row) => {
    setEditingPayable(row);
    setPayableForm({
      vendor: row.vendor || "",
      reference_no: row.reference_no || "",
      source: row.source || "Fabric Purchase",
      total_amount: String(row.total_amount ?? ""),
      paid_amount: String(row.paid_amount ?? ""),
      due_date: (row.due_date || "").slice(0, 10),
      notes: row.notes || "",
    });
    setPayableDrawerOpen(true);
  };

  const submitPayable = async (e) => {
    e.preventDefault();
    const payload = {
      vendor: payableForm.vendor.trim(),
      reference_no: payableForm.reference_no.trim(),
      source: payableForm.source,
      total_amount: Number(payableForm.total_amount || 0),
      paid_amount: Number(payableForm.paid_amount || 0),
      due_date: payableForm.due_date || null,
      notes: payableForm.notes.trim(),
    };
    if (!payload.vendor || !payload.reference_no || payload.total_amount <= 0) {
      toast.error("Vendor, reference no, and total amount are required");
      return;
    }
    if (payload.paid_amount < 0 || payload.total_amount < 0) {
      toast.error("Amounts cannot be negative");
      return;
    }
    if (payload.paid_amount > payload.total_amount) {
      toast.error("Paid amount cannot exceed total amount");
      return;
    }
    try {
      if (editingPayable) {
        await api.patch(`/payables/${editingPayable.id}`, payload);
        toast.success("Payable updated");
      } else {
        await api.post("/payables", payload);
        toast.success("Payable created");
      }
      setPayableDrawerOpen(false);
      setEditingPayable(null);
      setPayableForm(emptyPayableForm);
      await loadPayables();
      await loadDashboard();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to save payable");
    }
  };

  const confirmPayableDelete = async () => {
    if (!payableDeleteTarget) return;
    try {
      await api.delete(`/payables/${payableDeleteTarget.id}`);
      toast.success("Payable deleted");
      setPayableDeleteTarget(null);
      await loadPayables();
      await loadDashboard();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to delete payable");
    }
  };

  const openNewReceivable = () => {
    setEditingReceivable(null);
    setReceivableForm({ ...emptyReceivableForm, due_date: "" });
    setReceivableDrawerOpen(true);
  };

  const openEditReceivable = (row) => {
    setEditingReceivable(row);
    setReceivableForm({
      customer: row.customer || "",
      invoice_no: row.invoice_no || "",
      total_amount: String(row.total_amount ?? ""),
      received_amount: String(row.received_amount ?? ""),
      due_date: (row.due_date || "").slice(0, 10),
      notes: row.notes || "",
    });
    setReceivableDrawerOpen(true);
  };

  const submitReceivable = async (e) => {
    e.preventDefault();
    const payload = {
      customer: receivableForm.customer.trim(),
      invoice_no: receivableForm.invoice_no.trim(),
      total_amount: Number(receivableForm.total_amount || 0),
      received_amount: Number(receivableForm.received_amount || 0),
      due_date: receivableForm.due_date || null,
      notes: receivableForm.notes.trim(),
    };
    if (!payload.customer || !payload.invoice_no || payload.total_amount <= 0) {
      toast.error("Customer, invoice no, and total amount are required");
      return;
    }
    if (payload.received_amount < 0 || payload.total_amount < 0) {
      toast.error("Amounts cannot be negative");
      return;
    }
    if (payload.received_amount > payload.total_amount) {
      toast.error("Received amount cannot exceed total amount");
      return;
    }
    try {
      if (editingReceivable) {
        await api.patch(`/receivables/${editingReceivable.id}`, payload);
        toast.success("Receivable updated");
      } else {
        await api.post("/receivables", payload);
        toast.success("Receivable created");
      }
      setReceivableDrawerOpen(false);
      setEditingReceivable(null);
      setReceivableForm(emptyReceivableForm);
      await loadReceivables();
      await loadDashboard();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to save receivable");
    }
  };

  const confirmReceivableDelete = async () => {
    if (!receivableDeleteTarget) return;
    try {
      await api.delete(`/receivables/${receivableDeleteTarget.id}`);
      toast.success("Receivable deleted");
      setReceivableDeleteTarget(null);
      await loadReceivables();
      await loadDashboard();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to delete receivable");
    }
  };

  const openNewTransaction = () => {
    setEditingTransaction(null);
    setTransactionForm({ ...emptyTransactionForm, date: new Date().toISOString().slice(0, 10) });
    setTransactionDrawerOpen(true);
  };

  const openEditTransaction = (row) => {
    setEditingTransaction(row);
    setTransactionForm({
      date: (row.date || "").slice(0, 10),
      transaction_type: row.transaction_type || "Payment Given",
      party: row.party || "",
      reference_no: row.reference_no || "",
      payable_id: row.payable_id || "",
      receivable_id: row.receivable_id || "",
      amount: String(row.amount ?? ""),
      payment_mode: row.payment_mode || "Cash",
      notes: row.notes || "",
    });
    setTransactionDrawerOpen(true);
  };

  const submitTransaction = async (e) => {
    e.preventDefault();
    const payload = {
      date: transactionForm.date || null,
      transaction_type: transactionForm.transaction_type,
      party: transactionForm.party.trim(),
      reference_no: transactionForm.reference_no.trim(),
      payable_id: transactionForm.transaction_type === "Payment Given" ? transactionForm.payable_id || null : null,
      receivable_id: transactionForm.transaction_type === "Payment Received" ? transactionForm.receivable_id || null : null,
      amount: Number(transactionForm.amount || 0),
      payment_mode: transactionForm.payment_mode,
      notes: transactionForm.notes.trim(),
    };
    if (!payload.party || payload.amount <= 0) {
      toast.error("Party and amount are required");
      return;
    }
    if (payload.amount < 0) {
      toast.error("Amounts cannot be negative");
      return;
    }
    if (payload.transaction_type === "Payment Given" && !payload.payable_id) {
      toast.error("Please select a payable reference for this payment");
      return;
    }
    if (payload.transaction_type === "Payment Received" && !payload.receivable_id) {
      toast.error("Please select a receivable invoice for this receipt");
      return;
    }
    try {
      if (editingTransaction) {
        await api.patch(`/payment-transactions/${editingTransaction.id}`, payload);
        toast.success("Transaction updated");
      } else {
        await api.post("/payment-transactions", payload);
        toast.success("Transaction created");
      }
      setTransactionDrawerOpen(false);
      setEditingTransaction(null);
      setTransactionForm(emptyTransactionForm);
      await loadTransactions();
      await loadPayables();
      await loadReceivables();
      await loadDashboard();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to save transaction");
    }
  };

  const confirmTransactionDelete = async () => {
    if (!transactionDeleteTarget) return;
    try {
      await api.delete(`/payment-transactions/${transactionDeleteTarget.id}`);
      toast.success("Transaction deleted");
      setTransactionDeleteTarget(null);
      await loadTransactions();
      await loadDashboard();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to delete transaction");
    }
  };

  const triggerImport = (type) => {
    if (type === "payables") payableImportRef.current?.click();
    if (type === "receivables") receivableImportRef.current?.click();
    if (type === "transactions") transactionImportRef.current?.click();
  };

  const handleImport = async (event, endpoint) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await api.post(endpoint, fd, { headers: { "Content-Type": "multipart/form-data" } });
      const created = res.data?.created || 0;
      const errors = res.data?.errors || [];
      if (created > 0) toast.success(`Imported ${created} rows`);
      if (errors.length) toast.warning(`${errors.length} rows had errors`);
      if (!created && !errors.length) toast.info("No rows imported");
      if (endpoint === "/import/payables") {
        await loadPayables();
        await loadDashboard();
      }
      if (endpoint === "/import/receivables") {
        await loadReceivables();
        await loadDashboard();
      }
      if (endpoint === "/import/payment-transactions") {
        await loadTransactions();
        await loadPayables();
        await loadReceivables();
        await loadDashboard();
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || "Import failed");
    } finally {
      setImportBusy(false);
      event.target.value = "";
    }
  };

  const exportExcel = async (endpoint, filename) => {
    try {
      const res = await api.get(endpoint, { responseType: "blob" });
      const blob = new Blob([res.data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${filename}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Excel exported");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Export failed");
    }
  };

  const payableSummary = useMemo(() => {
    const total = payables.reduce((sum, item) => sum + Number(item.total_amount || 0), 0);
    const paid = payables.reduce((sum, item) => sum + Number(item.paid_amount || 0), 0);
    const pending = payables.filter((item) => item.status !== "Paid").reduce((sum, item) => sum + Number(item.balance_amount || 0), 0);
    const overdue = payables.filter((item) => item.status === "Overdue").reduce((sum, item) => sum + Number(item.balance_amount || 0), 0);
    return { total, paid, pending, overdue };
  }, [payables]);

  const receivableSummary = useMemo(() => {
    const total = receivables.reduce((sum, item) => sum + Number(item.total_amount || 0), 0);
    const received = receivables.reduce((sum, item) => sum + Number(item.received_amount || 0), 0);
    const pending = receivables.filter((item) => item.status !== "Paid").reduce((sum, item) => sum + Number(item.balance_amount || 0), 0);
    const overdue = receivables.filter((item) => item.status === "Overdue").reduce((sum, item) => sum + Number(item.balance_amount || 0), 0);
    return { total, received, pending, overdue };
  }, [receivables]);

  const transactionSummary = useMemo(() => {
    const payments = transactions.filter((item) => item.transaction_type === "Payment Given").reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const receipts = transactions.filter((item) => item.transaction_type === "Payment Received").reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const cash = transactions.filter((item) => item.payment_mode === "Cash").reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const bank = transactions.filter((item) => item.payment_mode === "Bank").reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const upi = transactions.filter((item) => item.payment_mode === "UPI").reduce((sum, item) => sum + Number(item.amount || 0), 0);
    return { payments, receipts, cash, bank, upi };
  }, [transactions]);

  const filteredPayables = useMemo(() => {
    const q = search.trim().toLowerCase();
    return payables.filter((item) => {
      const matchesSearch = !q || [item.vendor, item.reference_no, item.source, item.notes].filter(Boolean).join(" ").toLowerCase().includes(q);
      const matchesStatus = statusFilter === "all" || item.status === statusFilter;
      const matchesSource = sourceFilter === "all" || item.source === sourceFilter;
      const matchesVendor = vendorFilter === "all" || item.vendor === vendorFilter;
      const dueDate = item.due_date || "";
      const matchesDate = (!payableDateFrom || dueDate >= payableDateFrom) && (!payableDateTo || dueDate <= payableDateTo);
      return matchesSearch && matchesStatus && matchesSource && matchesVendor && matchesDate;
    });
  }, [payables, search, statusFilter, sourceFilter, vendorFilter, payableDateFrom, payableDateTo]);

  const sortedPayables = useMemo(() => {
    const arr = [...filteredPayables];
    arr.sort((a, b) => {
      const av = a[sortBy] ?? "";
      const bv = b[sortBy] ?? "";
      if (sortBy === "date") {
        return sortDir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      }
      if (["total_amount", "paid_amount", "balance_amount"].includes(sortBy)) {
        return sortDir === "asc" ? Number(av || 0) - Number(bv || 0) : Number(bv || 0) - Number(av || 0);
      }
      return sortDir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
    return arr;
  }, [filteredPayables, sortBy, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedPayables.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedPayables = sortedPayables.slice((safePage - 1) * pageSize, safePage * pageSize);

  const filteredReceivables = useMemo(() => {
    const q = search.trim().toLowerCase();
    return receivables.filter((item) => {
      const matchesSearch = !q || [item.customer, item.invoice_no, item.notes].filter(Boolean).join(" ").toLowerCase().includes(q);
      const matchesStatus = statusFilter === "all" || item.status === statusFilter;
      const matchesCustomer = customerFilter === "all" || item.customer === customerFilter;
      const dueDate = item.due_date || "";
      const matchesDate = (!receivableDateFrom || dueDate >= receivableDateFrom) && (!receivableDateTo || dueDate <= receivableDateTo);
      return matchesSearch && matchesStatus && matchesCustomer && matchesDate;
    });
  }, [receivables, search, statusFilter, customerFilter, receivableDateFrom, receivableDateTo]);

  const sortedReceivables = useMemo(() => {
    const arr = [...filteredReceivables];
    arr.sort((a, b) => {
      const av = a[sortBy] ?? "";
      const bv = b[sortBy] ?? "";
      if (sortBy === "date") {
        return sortDir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      }
      if (["total_amount", "received_amount", "balance_amount"].includes(sortBy)) {
        return sortDir === "asc" ? Number(av || 0) - Number(bv || 0) : Number(bv || 0) - Number(av || 0);
      }
      return sortDir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
    return arr;
  }, [filteredReceivables, sortBy, sortDir]);

  const filteredTransactions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return transactions.filter((item) => {
      const matchesView = transactionView === "all" || item.transaction_type === (transactionView === "payment_given" ? "Payment Given" : "Payment Received");
      const matchesSearch = !q || [item.party, item.reference_no, item.payment_mode, item.notes].filter(Boolean).join(" ").toLowerCase().includes(q);
      const matchesParty = !transactionPartyFilter || [item.party].filter(Boolean).join(" ").toLowerCase().includes(transactionPartyFilter.toLowerCase());
      const matchesVoucher = transactionVoucherFilter === "all" || item.transaction_type === transactionVoucherFilter;
      const matchesMode = transactionModeFilter === "all" || item.payment_mode === transactionModeFilter;
      const moduleLabel = item.transaction_type === "Payment Given" ? "Payables" : "Receivables";
      const matchesModule = transactionModuleFilter === "all" || moduleLabel === transactionModuleFilter;
      const txDate = item.date || "";
      const matchesDate = (!transactionDateFrom || txDate >= transactionDateFrom) && (!transactionDateTo || txDate <= transactionDateTo);
      return matchesView && matchesSearch && matchesParty && matchesVoucher && matchesMode && matchesModule && matchesDate;
    });
  }, [transactions, search, transactionView, transactionPartyFilter, transactionVoucherFilter, transactionModeFilter, transactionModuleFilter, transactionDateFrom, transactionDateTo]);

  const sortedTransactions = useMemo(() => {
    const arr = [...filteredTransactions];
    arr.sort((a, b) => {
      const av = a.date || "";
      const bv = b.date || "";
      return sortDir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
    return arr;
  }, [filteredTransactions, sortDir]);

  const summaryTransactions = useMemo(() => {
    const given = sortedTransactions.filter((row) => row.transaction_type === "Payment Given").reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const received = sortedTransactions.filter((row) => row.transaction_type === "Payment Received").reduce((sum, row) => sum + Number(row.amount || 0), 0);
    return { given, received };
  }, [sortedTransactions]);

  const topVendors = useMemo(() => (payables || []).slice().sort((a, b) => Number(b.balance_amount || 0) - Number(a.balance_amount || 0)).slice(0, 5), [payables]);
  const topCustomers = useMemo(() => (receivables || []).slice().sort((a, b) => Number(b.balance_amount || 0) - Number(a.balance_amount || 0)).slice(0, 5), [receivables]);
  const recentTransactionsList = useMemo(() => (transactions || []).slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))).slice(0, 8), [transactions]);
  const cashFlowSummary = useMemo(() => ({
    inflow: transactionSummary.receipts,
    outflow: transactionSummary.payments,
    net: transactionSummary.receipts - transactionSummary.payments,
  }), [transactionSummary]);

  const dashboardRows = useMemo(() => {
    const q = dashboardSearch.trim().toLowerCase();
    const from = dashboardFrom ? new Date(dashboardFrom) : null;
    const to = dashboardTo ? new Date(dashboardTo) : null;
    const rows = [
      ...(dashboard?.due_this_week || []).map((row) => ({ ...row, type: "payable", party: row.vendor })),
      ...(dashboard?.receipts_this_week || []).map((row) => ({ ...row, type: "receivable", party: row.customer })),
    ].filter((row) => {
      if (!q) return true;
      return [row.party, row.amount, row.status].filter(Boolean).join(" ").toLowerCase().includes(q);
    }).filter((row) => {
      const due = row.due_date ? new Date(row.due_date) : null;
      if (!due) return true;
      if (from && due < from) return false;
      if (to && due > to) return false;
      return true;
    });
    return rows;
  }, [dashboard, dashboardSearch, dashboardFrom, dashboardTo]);

  const renderSortButton = (key, label) => (
    <button type="button" onClick={() => { if (sortBy === key) setSortDir((prev) => (prev === "asc" ? "desc" : "asc")); else { setSortBy(key); setSortDir("asc"); } }} className="inline-flex items-center gap-1 text-left font-medium text-slate-600 hover:text-slate-900">
      {label}
      {sortBy === key ? (sortDir === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />) : <ArrowUpDown className="h-3.5 w-3.5" />}
    </button>
  );

  const renderTableControls = (onExport, importEndpoint, importRef) => (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" onClick={() => triggerImport(importEndpoint === "/import/payables" ? "payables" : importEndpoint === "/import/receivables" ? "receivables" : "transactions")} className="border-slate-300" disabled={importBusy}>
        <Upload className="mr-2 h-4 w-4" /> {importBusy ? "Importing..." : "Import"}
      </Button>
      <Button type="button" variant="outline" onClick={() => exportExcel(onExport.endpoint, onExport.filename)} className="border-slate-300">
        <Download className="mr-2 h-4 w-4" /> Export
      </Button>
      <input ref={importRef} type="file" accept=".csv,.xlsx,.xls" onChange={(e) => handleImport(e, importEndpoint)} className="hidden" />
    </div>
  );

  const renderPagination = (rowsLength) => {
    const totalPages = Math.max(1, Math.ceil(rowsLength / pageSize));
    const safePage = Math.min(page, totalPages);
    return (
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
        <div>Showing {rowsLength === 0 ? 0 : (safePage - 1) * pageSize + 1} to {Math.min(safePage * pageSize, rowsLength)} of {rowsLength} records</div>
        <div className="flex items-center gap-2">
          <select value={String(pageSize)} onChange={(e) => setPageSize(Number(e.target.value))} className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs">
            {pageSizeOptions.map((option) => <option key={option} value={option}>{option} / page</option>)}
          </select>
          <Button type="button" variant="outline" size="sm" disabled={safePage <= 1} onClick={() => setPage((prev) => Math.max(prev - 1, 1))}>Previous</Button>
          <span>Page {safePage} / {totalPages}</span>
          <Button type="button" variant="outline" size="sm" disabled={safePage >= totalPages} onClick={() => setPage((prev) => Math.min(prev + 1, totalPages))}>Next</Button>
        </div>
      </div>
    );
  };

  const renderPayableView = (row) => (
    <Sheet open={Boolean(detailTarget && detailType === "payable")} onOpenChange={(open) => !open && setDetailTarget(null)}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader className="border-b border-slate-200 pb-3">
          <SheetTitle>Payable Details</SheetTitle>
          <SheetDescription>{row?.vendor} • {row?.reference_no}</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 py-4 text-sm text-slate-700">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-md border border-slate-200 p-3"><div className="text-xs uppercase tracking-wide text-slate-500">Vendor</div><div className="mt-1 font-semibold text-slate-900">{row?.vendor}</div></div>
            <div className="rounded-md border border-slate-200 p-3"><div className="text-xs uppercase tracking-wide text-slate-500">Reference</div><div className="mt-1 font-semibold text-slate-900">{row?.reference_no}</div></div>
            <div className="rounded-md border border-slate-200 p-3"><div className="text-xs uppercase tracking-wide text-slate-500">Source</div><div className="mt-1 font-semibold text-slate-900">{row?.source}</div></div>
            <div className="rounded-md border border-slate-200 p-3"><div className="text-xs uppercase tracking-wide text-slate-500">Balance</div><div className="mt-1 font-semibold text-slate-900">{fmtMoney(row?.balance_amount || 0)}</div></div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {payableMetricCards.map((metric) => (
              <div key={metric.key} className="rounded-md border border-slate-200 p-3">
                <div className="text-xs uppercase tracking-wide text-slate-500">{metric.label}</div>
                <div className="mt-1 font-semibold text-slate-900">{fmtMoney(row?.[metric.key] || 0)}</div>
              </div>
            ))}
          </div>
          <div className="rounded-md border border-slate-200 p-3"><div className="text-xs uppercase tracking-wide text-slate-500">Adjustment History</div><div className="mt-2 space-y-2">{transactions.filter((entry) => entry.transaction_type === "Adjustment" && entry.payable_id === row?.id).length ? transactions.filter((entry) => entry.transaction_type === "Adjustment" && entry.payable_id === row?.id).map((entry) => <div key={entry.id} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2"><span>{fmtDate(entry.date)} • {entry.payment_mode}</span><span className="font-medium">{fmtMoney(entry.amount)}</span></div>) : <div className="text-slate-500">No adjustment entries recorded yet.</div>}</div></div>
          <div className="rounded-md border border-slate-200 p-3"><div className="text-xs uppercase tracking-wide text-slate-500">Payment History</div><div className="mt-2 space-y-2">{transactions.filter((entry) => entry.transaction_type === "Payment Given" && entry.payable_id === row?.id).length ? transactions.filter((entry) => entry.transaction_type === "Payment Given" && entry.payable_id === row?.id).map((entry) => <div key={entry.id} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2"><span>{fmtDate(entry.date)} • {entry.payment_mode}</span><span className="font-medium">{fmtMoney(entry.amount)}</span></div>) : <div className="text-slate-500">No payments recorded yet.</div>}</div></div>
          <div className="rounded-md border border-slate-200 p-3"><div className="text-xs uppercase tracking-wide text-slate-500">Notes</div><div className="mt-1 text-slate-700">{row?.notes || "—"}</div></div>
        </div>
      </SheetContent>
    </Sheet>
  );

  const renderReceivableView = (row) => (
    <Sheet open={Boolean(detailTarget && detailType === "receivable")} onOpenChange={(open) => !open && setDetailTarget(null)}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader className="border-b border-slate-200 pb-3">
          <SheetTitle>Receivable Details</SheetTitle>
          <SheetDescription>{row?.customer} • {row?.invoice_no}</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 py-4 text-sm text-slate-700">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-md border border-slate-200 p-3"><div className="text-xs uppercase tracking-wide text-slate-500">Customer</div><div className="mt-1 font-semibold text-slate-900">{row?.customer}</div></div>
            <div className="rounded-md border border-slate-200 p-3"><div className="text-xs uppercase tracking-wide text-slate-500">Invoice</div><div className="mt-1 font-semibold text-slate-900">{row?.invoice_no}</div></div>
            <div className="rounded-md border border-slate-200 p-3"><div className="text-xs uppercase tracking-wide text-slate-500">Total</div><div className="mt-1 font-semibold text-slate-900">{fmtMoney(row?.total_amount || 0)}</div></div>
            <div className="rounded-md border border-slate-200 p-3"><div className="text-xs uppercase tracking-wide text-slate-500">Balance</div><div className="mt-1 font-semibold text-slate-900">{fmtMoney(row?.balance_amount || 0)}</div></div>
          </div>
          <div className="rounded-md border border-slate-200 p-3"><div className="text-xs uppercase tracking-wide text-slate-500">Payment History</div><div className="mt-2 space-y-2">{transactions.filter((entry) => entry.transaction_type === "Payment Received" && entry.receivable_id === row?.id).length ? transactions.filter((entry) => entry.transaction_type === "Payment Received" && entry.receivable_id === row?.id).map((entry) => <div key={entry.id} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2"><span>{fmtDate(entry.date)} • {entry.payment_mode}</span><span className="font-medium">{fmtMoney(entry.amount)}</span></div>) : <div className="text-slate-500">No receipts recorded yet.</div>}</div></div>
          <div className="rounded-md border border-slate-200 p-3"><div className="text-xs uppercase tracking-wide text-slate-500">Notes</div><div className="mt-1 text-slate-700">{row?.notes || "—"}</div></div>
        </div>
      </SheetContent>
    </Sheet>
  );

  if (module === "dashboard") {
    return (
      <div data-testid="payments-dashboard-page" className="space-y-4">
        <PageHeader title="Payments Dashboard" subtitle="Professional accounts outlook for payables, receivables and transactions" actions={<Button type="button" variant="outline" onClick={loadAll} className="border-slate-300"><RefreshCcw className="mr-2 h-4 w-4" /> Refresh</Button>} />

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <StatCard label="Total Payables" value={fmtMoney(dashboard?.summary?.total_payable ?? payableSummary.total)} hint="Outstanding obligations" tone="slate" icon={BadgeDollarSign} />
          <StatCard label="Paid" value={fmtMoney(dashboard?.summary?.paid ?? payableSummary.paid)} hint="Settled amount" tone="positive" icon={HandCoins} />
          <StatCard label="Balance Payable" value={fmtMoney(dashboard?.summary?.balance_payable ?? payableSummary.pending)} hint="Pending to clear" tone="warning" icon={FileText} />
          <StatCard label="Total Receivables" value={fmtMoney(dashboard?.summary?.total_receivable ?? receivableSummary.total)} hint="Customer invoices" tone="slate" icon={ReceiptText} />
          <StatCard label="Received" value={fmtMoney(dashboard?.summary?.received ?? receivableSummary.received)} hint="Payments collected" tone="positive" icon={CircleDollarSign} />
          <StatCard label="Balance Receivable" value={fmtMoney(dashboard?.summary?.balance_receivable ?? receivableSummary.pending)} hint="Expected receipts" tone="warning" icon={Banknote} />
        </div>

        <Card className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <Input value={dashboardSearch} onChange={(e) => setDashboardSearch(e.target.value)} placeholder="Search due/expected payments" className="h-9 w-[280px]" />
              <Input type="date" value={dashboardFrom} onChange={(e) => setDashboardFrom(e.target.value)} className="h-9 w-[170px]" />
              <Input type="date" value={dashboardTo} onChange={(e) => setDashboardTo(e.target.value)} className="h-9 w-[170px]" />
              <Button type="button" variant="outline" onClick={() => { setDashboardSearch(""); setDashboardFrom(""); setDashboardTo(""); }} className="border-slate-300">Clear</Button>
            </div>
            <Button type="button" variant="outline" onClick={loadDashboard} className="border-slate-300"><RefreshCcw className="mr-2 h-4 w-4" /> Refresh</Button>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <div className="rounded-[20px] border border-slate-200 bg-slate-50/80 p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-semibold text-slate-900">Payments Due This Week</div>
                <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Payables</div>
              </div>
              <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                <Table>
                  <TableHeader><TableRow className="bg-slate-50"><TableHead>Vendor</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Due Date</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {dashboardRows.filter((row) => row.type === "payable").length === 0 && <TableRow><TableCell colSpan={4} className="py-6 text-center text-slate-500">No due payments in the selected range.</TableCell></TableRow>}
                    {dashboardRows.filter((row) => row.type === "payable").map((row, idx) => <TableRow key={`${row.party}-${idx}`}><TableCell>{row.party}</TableCell><TableCell className="text-right">{fmtMoney(row.amount)}</TableCell><TableCell>{fmtDate(row.due_date)}</TableCell><TableCell><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${formatStatus(row.status)}`}>{row.status}</span></TableCell></TableRow>)}
                  </TableBody>
                </Table>
              </div>
            </div>
            <div className="rounded-[20px] border border-slate-200 bg-slate-50/80 p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-semibold text-slate-900">Receipts Expected This Week</div>
                <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Receivables</div>
              </div>
              <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                <Table>
                  <TableHeader><TableRow className="bg-slate-50"><TableHead>Customer</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Due Date</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {dashboardRows.filter((row) => row.type === "receivable").length === 0 && <TableRow><TableCell colSpan={4} className="py-6 text-center text-slate-500">No expected receipts in the selected range.</TableCell></TableRow>}
                    {dashboardRows.filter((row) => row.type === "receivable").map((row, idx) => <TableRow key={`${row.party}-${idx}`}><TableCell>{row.party}</TableCell><TableCell className="text-right">{fmtMoney(row.amount)}</TableCell><TableCell>{fmtDate(row.due_date)}</TableCell><TableCell><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${formatStatus(row.status)}`}>{row.status}</span></TableCell></TableRow>)}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-[20px] border border-slate-200 bg-white p-3">
                <div className="mb-2 text-sm font-semibold text-slate-900">Recent Payments</div>
                <div className="overflow-hidden rounded-lg border border-slate-200">
                  <Table>
                    <TableHeader><TableRow className="bg-slate-50"><TableHead>Date</TableHead><TableHead>Party</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {(dashboard?.recent_payments || []).length === 0 && <TableRow><TableCell colSpan={3} className="py-6 text-center text-slate-500">No recent payments.</TableCell></TableRow>}
                      {(dashboard?.recent_payments || []).map((row) => <TableRow key={row.id}><TableCell>{fmtDate(row.date)}</TableCell><TableCell>{row.party}</TableCell><TableCell className="text-right">{fmtMoney(row.amount)}</TableCell></TableRow>)}
                    </TableBody>
                  </Table>
                </div>
              </div>
              <div className="rounded-[20px] border border-slate-200 bg-white p-3">
                <div className="mb-2 text-sm font-semibold text-slate-900">Recent Receipts</div>
                <div className="overflow-hidden rounded-lg border border-slate-200">
                  <Table>
                    <TableHeader><TableRow className="bg-slate-50"><TableHead>Date</TableHead><TableHead>Party</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {(dashboard?.recent_receipts || []).length === 0 && <TableRow><TableCell colSpan={3} className="py-6 text-center text-slate-500">No recent receipts.</TableCell></TableRow>}
                      {(dashboard?.recent_receipts || []).map((row) => <TableRow key={row.id}><TableCell>{fmtDate(row.date)}</TableCell><TableCell>{row.party}</TableCell><TableCell className="text-right">{fmtMoney(row.amount)}</TableCell></TableRow>)}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>

            <div className="grid gap-4">
              <div className="rounded-[20px] border border-slate-200 bg-white p-3">
                <div className="mb-2 text-sm font-semibold text-slate-900">Top Vendors by Outstanding</div>
                <div className="space-y-2">
                  {topVendors.length === 0 ? <div className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-500">No outstanding payables.</div> : topVendors.map((row) => (
                    <div key={row.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                      <span className="font-medium text-slate-700">{row.vendor}</span>
                      <span className="text-sm font-semibold text-slate-900">{fmtMoney(row.balance_amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-[20px] border border-slate-200 bg-white p-3">
                <div className="mb-2 text-sm font-semibold text-slate-900">Top Customers by Receivable</div>
                <div className="space-y-2">
                  {topCustomers.length === 0 ? <div className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-500">No outstanding receivables.</div> : topCustomers.map((row) => (
                    <div key={row.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                      <span className="font-medium text-slate-700">{row.customer}</span>
                      <span className="text-sm font-semibold text-slate-900">{fmtMoney(row.balance_amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1fr]">
            <div className="rounded-[20px] border border-slate-200 bg-white p-3">
              <div className="mb-2 text-sm font-semibold text-slate-900">Recent Transactions</div>
              <div className="overflow-hidden rounded-lg border border-slate-200">
                <Table>
                  <TableHeader><TableRow className="bg-slate-50"><TableHead>Date</TableHead><TableHead>Party</TableHead><TableHead>Type</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {recentTransactionsList.length === 0 ? <TableRow><TableCell colSpan={4} className="py-6 text-center text-slate-500">No recent transactions.</TableCell></TableRow> : recentTransactionsList.map((row) => <TableRow key={row.id}><TableCell>{fmtDate(row.date)}</TableCell><TableCell>{row.party}</TableCell><TableCell>{row.transaction_type}</TableCell><TableCell className="text-right">{fmtMoney(row.amount)}</TableCell></TableRow>)}
                  </TableBody>
                </Table>
              </div>
            </div>
            <div className="rounded-[20px] border border-slate-200 bg-white p-3">
              <div className="mb-2 text-sm font-semibold text-slate-900">Cash Flow Summary</div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-3"><div className="text-xs uppercase tracking-[0.24em] text-slate-500">Inflow</div><div className="mt-2 font-semibold text-slate-900">{fmtMoney(cashFlowSummary.inflow)}</div></div>
                <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-3"><div className="text-xs uppercase tracking-[0.24em] text-slate-500">Outflow</div><div className="mt-2 font-semibold text-slate-900">{fmtMoney(cashFlowSummary.outflow)}</div></div>
                <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-3"><div className="text-xs uppercase tracking-[0.24em] text-slate-500">Net</div><div className={`mt-2 font-semibold ${cashFlowSummary.net >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{fmtMoney(cashFlowSummary.net)}</div></div>
              </div>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  if (module === "payables") {
    return (
      <div data-testid="payables-page" className="space-y-4">
        <PageHeader title="Payables" subtitle="Professional vendor liability tracking with ERP-style controls" actions={<div className="flex flex-wrap items-center gap-2"><Button onClick={openNewPayable} className="bg-violet-600 hover:bg-violet-700"><Plus className="mr-2 h-4 w-4" /> Add Payable</Button>{renderTableControls({ endpoint: "/export/payables", filename: "payables" }, "/import/payables", payableImportRef)}</div>} />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Total Payables" value={fmtMoney(payableSummary.total)} hint="Open liabilities" tone="slate" icon={BadgeDollarSign} />
          <StatCard label="Paid" value={fmtMoney(payableSummary.paid)} hint="Settled to date" tone="positive" icon={HandCoins} />
          <StatCard label="Pending" value={fmtMoney(payableSummary.pending)} hint="Outstanding balance" tone="warning" icon={FileText} />
          <StatCard label="Overdue" value={fmtMoney(payableSummary.overdue)} hint="Past due" tone="warning" icon={CalendarRange} />
        </div>
        <Card className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search vendor or reference" className="h-9 w-[280px]" />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"><option value="all">All Status</option><option value="Paid">Paid</option><option value="Partial">Partial</option><option value="Pending">Pending</option><option value="Overdue">Overdue</option></select>
            <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"><option value="all">All Sources</option>{payableSources.map((source) => <option key={source} value={source}>{source}</option>)}</select>
            <select value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)} className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"><option value="all">All Vendors</option>{Array.from(new Set(payables.map((item) => item.vendor).filter(Boolean))).map((vendor) => <option key={vendor} value={vendor}>{vendor}</option>)}</select>
            <Input type="date" value={payableDateFrom} onChange={(e) => setPayableDateFrom(e.target.value)} className="h-9 w-[155px]" />
            <Input type="date" value={payableDateTo} onChange={(e) => setPayableDateTo(e.target.value)} className="h-9 w-[155px]" />
          </div>
        </Card>
        <Card className="overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-sm">
          <Table>
            <TableHeader><TableRow className="bg-slate-50"><TableHead>Vendor</TableHead><TableHead>Reference No.</TableHead><TableHead>Source Module</TableHead><TableHead>Due Date</TableHead><TableHead className="text-right">Total Amount</TableHead><TableHead className="text-right">Paid</TableHead><TableHead className="text-right">Balance</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
            <TableBody>
              {loading && <TableRow><TableCell colSpan={9} className="py-8 text-center text-slate-500">Loading payables...</TableCell></TableRow>}
              {!loading && pagedPayables.length === 0 && <TableRow><TableCell colSpan={9} className="py-8 text-center text-slate-500">No payables found.</TableCell></TableRow>}
              {!loading && pagedPayables.map((row) => <TableRow key={row.id}><TableCell>{row.vendor}</TableCell><TableCell>{row.reference_no}</TableCell><TableCell>{row.source}</TableCell><TableCell>{fmtDate(row.due_date)}</TableCell><TableCell className="text-right">{fmtMoney(row.total_amount)}</TableCell><TableCell className="text-right">{fmtMoney(row.paid_amount)}</TableCell><TableCell className="text-right">{fmtMoney(row.balance_amount)}</TableCell><TableCell><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${formatStatus(row.status)}`}>{row.status}</span></TableCell><TableCell><div className="flex items-center justify-end gap-1"><Button variant="ghost" size="icon" onClick={() => { setDetailTarget(row); setDetailType("payable"); }}><Eye className="h-4 w-4 text-slate-600" /></Button><Button variant="ghost" size="icon" onClick={() => openEditPayable(row)}><Pencil className="h-4 w-4 text-slate-600" /></Button><Button variant="ghost" size="icon" onClick={() => setPayableDeleteTarget(row)}><Trash2 className="h-4 w-4 text-red-600" /></Button></div></TableCell></TableRow>)}
            </TableBody>
          </Table>
        </Card>
        {renderPagination(sortedPayables.length)}
        <Sheet open={payableDrawerOpen} onOpenChange={(open) => { setPayableDrawerOpen(open); if (!open) { setEditingPayable(null); setPayableForm(emptyPayableForm); } }}>
          <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
            <SheetHeader className="border-b border-slate-200 pb-3"><SheetTitle>{editingPayable ? "Edit Payable" : "Add Payable"}</SheetTitle><SheetDescription>Record vendor payable obligations and payment progress.</SheetDescription></SheetHeader>
            <form onSubmit={submitPayable} className="space-y-4 py-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div><Label>Vendor *</Label><Input value={payableForm.vendor} onChange={(e) => setPayableForm((prev) => ({ ...prev, vendor: e.target.value }))} className="mt-1" /></div>
                <div><Label>Reference No. *</Label><Input value={payableForm.reference_no} onChange={(e) => setPayableForm((prev) => ({ ...prev, reference_no: e.target.value }))} className="mt-1" /></div>
                <div><Label>Source</Label><select value={payableForm.source} onChange={(e) => setPayableForm((prev) => ({ ...prev, source: e.target.value }))} className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm">{payableSources.map((source) => <option key={source} value={source}>{source}</option>)}</select></div>
                <div><Label>Due Date</Label><Input type="date" value={payableForm.due_date} onChange={(e) => setPayableForm((prev) => ({ ...prev, due_date: e.target.value }))} className="mt-1" /></div>
                <div><Label>Total Amount *</Label><Input type="number" min="0" step="0.01" value={payableForm.total_amount} onChange={(e) => setPayableForm((prev) => ({ ...prev, total_amount: e.target.value }))} className="mt-1" /></div>
                <div><Label>Paid Amount</Label><Input type="number" min="0" step="0.01" value={payableForm.paid_amount} onChange={(e) => setPayableForm((prev) => ({ ...prev, paid_amount: e.target.value }))} className="mt-1" /></div>
                <div className="md:col-span-2"><Label>Notes</Label><Textarea value={payableForm.notes} onChange={(e) => setPayableForm((prev) => ({ ...prev, notes: e.target.value }))} className="mt-1 min-h-[90px]" /></div>
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-200 pt-4"><Button type="button" variant="outline" onClick={() => setPayableDrawerOpen(false)}>Cancel</Button><Button type="submit" className="bg-slate-900 hover:bg-slate-800">Save</Button></div>
            </form>
          </SheetContent>
        </Sheet>
        {renderPayableView(detailTarget)}
        <AlertDialog open={Boolean(payableDeleteTarget)} onOpenChange={(open) => !open && setPayableDeleteTarget(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete Payable</AlertDialogTitle><AlertDialogDescription>This will remove the payable record permanently.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={confirmPayableDelete} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
      </div>
    );
  }

  if (module === "receivables") {
    return (
      <div data-testid="receivables-page" className="space-y-4">
        <PageHeader title="Receivables" subtitle="Customer invoice and receipt tracking in a structured ERP view" actions={<div className="flex flex-wrap items-center gap-2"><Button onClick={openNewReceivable} className="bg-violet-600 hover:bg-violet-700"><Plus className="mr-2 h-4 w-4" /> Add Receivable</Button>{renderTableControls({ endpoint: "/export/receivables", filename: "receivables" }, "/import/receivables", receivableImportRef)}</div>} />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Total Receivable" value={fmtMoney(receivableSummary.total)} hint="Open customer dues" tone="slate" icon={BadgeDollarSign} />
          <StatCard label="Received" value={fmtMoney(receivableSummary.received)} hint="Collected amount" tone="positive" icon={HandCoins} />
          <StatCard label="Pending" value={fmtMoney(receivableSummary.pending)} hint="Outstanding balance" tone="warning" icon={FileText} />
          <StatCard label="Overdue" value={fmtMoney(receivableSummary.overdue)} hint="Past due invoices" tone="warning" icon={CalendarRange} />
        </div>
        <Card className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customer or invoice" className="h-9 w-[280px]" />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"><option value="all">All Status</option><option value="Paid">Paid</option><option value="Partial">Partial</option><option value="Pending">Pending</option><option value="Overdue">Overdue</option></select>
            <select value={customerFilter} onChange={(e) => setCustomerFilter(e.target.value)} className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"><option value="all">All Customers</option>{Array.from(new Set(receivables.map((item) => item.customer).filter(Boolean))).map((customer) => <option key={customer} value={customer}>{customer}</option>)}</select>
            <Input type="date" value={receivableDateFrom} onChange={(e) => setReceivableDateFrom(e.target.value)} className="h-9 w-[155px]" />
            <Input type="date" value={receivableDateTo} onChange={(e) => setReceivableDateTo(e.target.value)} className="h-9 w-[155px]" />
          </div>
        </Card>
        <Card className="overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-sm">
          <Table>
            <TableHeader><TableRow className="bg-slate-50"><TableHead>Customer</TableHead><TableHead>Invoice Number</TableHead><TableHead>Source</TableHead><TableHead>Due Date</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Received</TableHead><TableHead className="text-right">Balance</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
            <TableBody>
              {loading && <TableRow><TableCell colSpan={9} className="py-8 text-center text-slate-500">Loading receivables...</TableCell></TableRow>}
              {!loading && sortedReceivables.length === 0 && <TableRow><TableCell colSpan={9} className="py-8 text-center text-slate-500">No receivables found.</TableCell></TableRow>}
              {!loading && sortedReceivables.map((row) => <TableRow key={row.id}><TableCell>{row.customer}</TableCell><TableCell>{row.invoice_no}</TableCell><TableCell>{row.source || "—"}</TableCell><TableCell>{fmtDate(row.due_date)}</TableCell><TableCell className="text-right">{fmtMoney(row.total_amount)}</TableCell><TableCell className="text-right">{fmtMoney(row.received_amount)}</TableCell><TableCell className="text-right">{fmtMoney(row.balance_amount)}</TableCell><TableCell><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${formatStatus(row.status)}`}>{row.status}</span></TableCell><TableCell><div className="flex items-center justify-end gap-1"><Button variant="ghost" size="icon" onClick={() => { setDetailTarget(row); setDetailType("receivable"); }}><Eye className="h-4 w-4 text-slate-600" /></Button><Button variant="ghost" size="icon" onClick={() => openEditReceivable(row)}><Pencil className="h-4 w-4 text-slate-600" /></Button><Button variant="ghost" size="icon" onClick={() => setReceivableDeleteTarget(row)}><Trash2 className="h-4 w-4 text-red-600" /></Button></div></TableCell></TableRow>)}
            </TableBody>
          </Table>
        </Card>
        {renderPagination(sortedReceivables.length)}
        <Sheet open={receivableDrawerOpen} onOpenChange={(open) => { setReceivableDrawerOpen(open); if (!open) { setEditingReceivable(null); setReceivableForm(emptyReceivableForm); } }}>
          <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
            <SheetHeader className="border-b border-slate-200 pb-3"><SheetTitle>{editingReceivable ? "Edit Receivable" : "Add Receivable"}</SheetTitle><SheetDescription>Record customer invoice balances and receipts.</SheetDescription></SheetHeader>
            <form onSubmit={submitReceivable} className="space-y-4 py-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div><Label>Customer *</Label><Input value={receivableForm.customer} onChange={(e) => setReceivableForm((prev) => ({ ...prev, customer: e.target.value }))} className="mt-1" /></div>
                <div><Label>Invoice No. *</Label><Input value={receivableForm.invoice_no} onChange={(e) => setReceivableForm((prev) => ({ ...prev, invoice_no: e.target.value }))} className="mt-1" /></div>
                <div><Label>Due Date</Label><Input type="date" value={receivableForm.due_date} onChange={(e) => setReceivableForm((prev) => ({ ...prev, due_date: e.target.value }))} className="mt-1" /></div>
                <div><Label>Total Amount *</Label><Input type="number" min="0" step="0.01" value={receivableForm.total_amount} onChange={(e) => setReceivableForm((prev) => ({ ...prev, total_amount: e.target.value }))} className="mt-1" /></div>
                <div><Label>Received Amount</Label><Input type="number" min="0" step="0.01" value={receivableForm.received_amount} onChange={(e) => setReceivableForm((prev) => ({ ...prev, received_amount: e.target.value }))} className="mt-1" /></div>
                <div className="md:col-span-2"><Label>Notes</Label><Textarea value={receivableForm.notes} onChange={(e) => setReceivableForm((prev) => ({ ...prev, notes: e.target.value }))} className="mt-1 min-h-[90px]" /></div>
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-200 pt-4"><Button type="button" variant="outline" onClick={() => setReceivableDrawerOpen(false)}>Cancel</Button><Button type="submit" className="bg-slate-900 hover:bg-slate-800">Save</Button></div>
            </form>
          </SheetContent>
        </Sheet>
        {renderReceivableView(detailTarget)}
        <AlertDialog open={Boolean(receivableDeleteTarget)} onOpenChange={(open) => !open && setReceivableDeleteTarget(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete Receivable</AlertDialogTitle><AlertDialogDescription>This will remove the receivable record permanently.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={confirmReceivableDelete} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
      </div>
    );
  }

  return (
    <div data-testid="transactions-page" className="space-y-4">
      <PageHeader title="Transactions" subtitle="A professional transaction register for payments and receipts" actions={<div className="flex flex-wrap items-center gap-2"><Button onClick={openNewTransaction} className="bg-violet-600 hover:bg-violet-700"><Plus className="mr-2 h-4 w-4" /> Add Transaction</Button>{renderTableControls({ endpoint: "/export/payment-transactions", filename: "payment_transactions" }, "/import/payment-transactions", transactionImportRef)}</div>} />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Payment Given" value={fmtMoney(summaryTransactions.given)} hint="Outflow" tone="warning" icon={ArrowUp} />
        <StatCard label="Payment Received" value={fmtMoney(summaryTransactions.received)} hint="Inflow" tone="positive" icon={ArrowDown} />
        <StatCard label="Cash" value={fmtMoney(transactionSummary.cash)} hint="Cash mode" tone="slate" icon={Banknote} />
        <StatCard label="Bank" value={fmtMoney(transactionSummary.bank)} hint="Bank mode" tone="slate" icon={BadgeDollarSign} />
        <StatCard label="UPI" value={fmtMoney(transactionSummary.upi)} hint="UPI mode" tone="slate" icon={CircleDollarSign} />
      </div>
      <Card className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search party or notes" className="h-9 w-[280px]" />
          <Input type="date" value={transactionDateFrom} onChange={(e) => setTransactionDateFrom(e.target.value)} className="h-9 w-[155px]" />
          <Input type="date" value={transactionDateTo} onChange={(e) => setTransactionDateTo(e.target.value)} className="h-9 w-[155px]" />
          <Input value={transactionPartyFilter} onChange={(e) => setTransactionPartyFilter(e.target.value)} placeholder="Party" className="h-9 w-[180px]" />
          <select value={transactionView} onChange={(e) => setTransactionView(e.target.value)} className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"><option value="all">All</option><option value="payment_given">Payment Given</option><option value="payment_received">Payment Received</option></select>
          <select value={transactionVoucherFilter} onChange={(e) => setTransactionVoucherFilter(e.target.value)} className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"><option value="all">Voucher Type</option><option value="Payment Given">Payment Given</option><option value="Payment Received">Payment Received</option></select>
          <select value={transactionModeFilter} onChange={(e) => setTransactionModeFilter(e.target.value)} className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"><option value="all">All Modes</option>{paymentModes.map((mode) => <option key={mode} value={mode}>{mode}</option>)}</select>
          <select value={transactionModuleFilter} onChange={(e) => setTransactionModuleFilter(e.target.value)} className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"><option value="all">All Modules</option><option value="Payables">Payables</option><option value="Receivables">Receivables</option></select>
        </div>
      </Card>
      <Card className="overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-sm">
        <Table>
          <TableHeader><TableRow className="bg-slate-50"><TableHead>Date</TableHead><TableHead>Voucher Type</TableHead><TableHead>Voucher No.</TableHead><TableHead>Party</TableHead><TableHead>Module</TableHead><TableHead>Reference No.</TableHead><TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Credit</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Payment Mode</TableHead><TableHead>Narration</TableHead><TableHead>Created By</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
          <TableBody>
            {loading && <TableRow><TableCell colSpan={13} className="py-8 text-center text-slate-500">Loading transactions...</TableCell></TableRow>}
            {!loading && sortedTransactions.length === 0 && <TableRow><TableCell colSpan={13} className="py-8 text-center text-slate-500">No transactions found.</TableCell></TableRow>}
            {!loading && sortedTransactions.map((row) => {
              const isPayment = row.transaction_type === "Payment Given";
              return (
                <TableRow key={row.id}>
                  <TableCell>{fmtDate(row.date)}</TableCell>
                  <TableCell>{row.transaction_type}</TableCell>
                  <TableCell>{row.reference_no || row.id?.slice(0, 8) || "—"}</TableCell>
                  <TableCell>{row.party}</TableCell>
                  <TableCell>{isPayment ? "Payables" : "Receivables"}</TableCell>
                  <TableCell>{row.reference_no || "—"}</TableCell>
                  <TableCell className="text-right">{isPayment ? fmtMoney(row.amount) : fmtMoney(0)}</TableCell>
                  <TableCell className="text-right">{isPayment ? fmtMoney(0) : fmtMoney(row.amount)}</TableCell>
                  <TableCell className="text-right">{fmtMoney(row.amount)}</TableCell>
                  <TableCell>{row.payment_mode}</TableCell>
                  <TableCell className="max-w-[220px] truncate">{row.notes || "—"}</TableCell>
                  <TableCell>System</TableCell>
                  <TableCell><div className="flex items-center justify-end gap-1"><Button variant="ghost" size="icon" onClick={() => openEditTransaction(row)}><Pencil className="h-4 w-4 text-slate-600" /></Button><Button variant="ghost" size="icon" onClick={() => setTransactionDeleteTarget(row)}><Trash2 className="h-4 w-4 text-red-600" /></Button></div></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
      {renderPagination(sortedTransactions.length)}
      <Sheet open={transactionDrawerOpen} onOpenChange={(open) => { setTransactionDrawerOpen(open); if (!open) { setEditingTransaction(null); setTransactionForm(emptyTransactionForm); } }}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader className="border-b border-slate-200 pb-3"><SheetTitle>{editingTransaction ? "Edit Transaction" : "Add Transaction"}</SheetTitle><SheetDescription>Log payments and receipts that automatically affect balances.</SheetDescription></SheetHeader>
          <form onSubmit={submitTransaction} className="space-y-4 py-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div><Label>Date</Label><Input type="date" value={transactionForm.date} onChange={(e) => setTransactionForm((prev) => ({ ...prev, date: e.target.value }))} className="mt-1" /></div>
              <div><Label>Payment Type</Label><select value={transactionForm.transaction_type} onChange={(e) => setTransactionForm((prev) => ({ ...prev, transaction_type: e.target.value, payable_id: "", receivable_id: "" }))} className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"><option value="Payment Given">Payment Given</option><option value="Payment Received">Payment Received</option></select></div>
              <div><Label>Party *</Label><Input value={transactionForm.party} onChange={(e) => setTransactionForm((prev) => ({ ...prev, party: e.target.value }))} className="mt-1" /></div>
              <div><Label>Reference No.</Label><Input value={transactionForm.reference_no} onChange={(e) => setTransactionForm((prev) => ({ ...prev, reference_no: e.target.value }))} className="mt-1" /></div>
              <div>{transactionForm.transaction_type === "Payment Given" ? <><Label>Payable *</Label><select value={transactionForm.payable_id} onChange={(e) => setTransactionForm((prev) => ({ ...prev, payable_id: e.target.value }))} className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"><option value="">Select payable</option>{payables.filter((item) => !item.archived).map((item) => <option key={item.id} value={item.id}>{item.reference_no} • {item.vendor}</option>)}</select></> : <><Label>Receivable *</Label><select value={transactionForm.receivable_id} onChange={(e) => setTransactionForm((prev) => ({ ...prev, receivable_id: e.target.value }))} className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"><option value="">Select receivable</option>{receivables.filter((item) => !item.archived).map((item) => <option key={item.id} value={item.id}>{item.invoice_no} • {item.customer}</option>)}</select></>}</div>
              <div><Label>Amount *</Label><Input type="number" min="0" step="0.01" value={transactionForm.amount} onChange={(e) => setTransactionForm((prev) => ({ ...prev, amount: e.target.value }))} className="mt-1" /></div>
              <div><Label>Payment Mode</Label><select value={transactionForm.payment_mode} onChange={(e) => setTransactionForm((prev) => ({ ...prev, payment_mode: e.target.value }))} className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm">{paymentModes.map((mode) => <option key={mode} value={mode}>{mode}</option>)}</select></div>
              <div className="md:col-span-2"><Label>Notes</Label><Textarea value={transactionForm.notes} onChange={(e) => setTransactionForm((prev) => ({ ...prev, notes: e.target.value }))} className="mt-1 min-h-[90px]" /></div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 pt-4"><Button type="button" variant="outline" onClick={() => setTransactionDrawerOpen(false)}>Cancel</Button><Button type="submit" className="bg-slate-900 hover:bg-slate-800">Save</Button></div>
          </form>
        </SheetContent>
      </Sheet>
      <AlertDialog open={Boolean(transactionDeleteTarget)} onOpenChange={(open) => !open && setTransactionDeleteTarget(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete Transaction</AlertDialogTitle><AlertDialogDescription>This will remove the transaction and recalculate balances.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={confirmTransactionDelete} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </div>
  );
}
