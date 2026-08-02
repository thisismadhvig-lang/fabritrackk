import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
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
  Download,
  Filter,
  Pencil,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import UniversalPrintButton from "@/components/erp/UniversalPrintButton";

const emptyForm = {
  date: "",
  dispatch_no: "",
  vendor_id: "",
  material_name: "",
  quantity: "",
  unit: "pcs",
  rate: "",
  purpose: "",
  notes: "",
};

const statusOptions = ["Dispatched"];

export default function MaterialDispatch() {
  const [items, setItems] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(true);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  const [search, setSearch] = useState("");
  const [materialSearch, setMaterialSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [vendorFilter, setVendorFilter] = useState("all");
  const [sortBy, setSortBy] = useState("date");
  const [sortDir, setSortDir] = useState("desc");

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedPrintIds, setSelectedPrintIds] = useState([]);

  const [deleteTarget, setDeleteTarget] = useState(null);

  const [importBusy, setImportBusy] = useState(false);
  const fileInputRef = useRef(null);
  const location = useLocation();
  const preselectedId = useMemo(() => new URLSearchParams(location.search).get("id"), [location.search]);

  const vendorMap = useMemo(
    () => Object.fromEntries(vendors.map((v) => [v.id, v.name])),
    [vendors],
  );

  const stockByMaterial = useMemo(() => {
    const aggregate = {};
    for (const row of inventory) {
      const key = `${row.material_name}||${row.unit}`;
      if (!aggregate[key]) {
        aggregate[key] = {
          material_name: row.material_name,
          unit: row.unit,
          quantity: 0,
          totalValue: 0,
        };
      }
      const qty = Number(row.quantity || 0);
      aggregate[key].quantity += qty;
      aggregate[key].totalValue += qty * Number(row.rate || 0);
    }
    return Object.values(aggregate)
      .filter((row) => row.quantity > 0)
      .map((row) => ({
        ...row,
        rate: row.quantity > 0 ? row.totalValue / row.quantity : 0,
      }))
      .sort((a, b) => a.material_name.localeCompare(b.material_name));
  }, [inventory]);

  const visibleStockEntries = useMemo(() => {
    const term = materialSearch.trim().toLowerCase();
    return stockByMaterial.filter((entry) => {
      if (!term) return true;
      return `${entry.material_name} ${entry.unit} ${entry.quantity}`.toLowerCase().includes(term);
    });
  }, [materialSearch, stockByMaterial]);

  const selectedStock = useMemo(() => {
    if (!form.material_name || !form.unit) return null;
    return stockByMaterial.find((entry) => entry.material_name === form.material_name && entry.unit === form.unit) || null;
  }, [form.material_name, form.unit, stockByMaterial]);

  const computedAmount = useMemo(() => {
    const q = Number(form.quantity || 0);
    const r = Number(form.rate || 0);
    return q > 0 && r > 0 ? q * r : 0;
  }, [form.quantity, form.rate]);

  const load = async () => {
    setLoading(true);
    try {
      const [dispatchRes, vendorRes, inventoryRes] = await Promise.all([
        api.get("/material-dispatches"),
        api.get("/vendors", { params: { include_archived: true } }),
        api.get("/material-inventory"),
      ]);
      setItems(dispatchRes.data || []);
      setVendors(vendorRes.data || []);
      setInventory(inventoryRes.data || []);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to load material dispatch data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!preselectedId || loading || items.length === 0) return;
    const match = items.find((item) => item.id === preselectedId);
    if (match && (!editing || editing.id !== preselectedId)) {
      openEdit(match);
    }
  }, [editing, items, loading, preselectedId]);

  const openNew = () => {
    setEditing(null);
    setMaterialSearch("");
    setForm({ ...emptyForm, date: new Date().toISOString().slice(0, 10) });
    setDrawerOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setMaterialSearch("");
    setForm({
      date: (row.date || "").slice(0, 10),
      dispatch_no: row.dispatch_no || "",
      vendor_id: row.vendor_id || "",
      material_name: row.material_name || "",
      quantity: String(row.quantity ?? ""),
      unit: row.unit || "pcs",
      rate: String(row.rate ?? ""),
      purpose: row.purpose || "",
      notes: row.notes || "",
    });
    setDrawerOpen(true);
  };

  const validateForm = () => {
    if (!form.date || !form.dispatch_no || !form.vendor_id || !form.material_name || !form.quantity || !form.unit || !form.rate) {
      toast.error("Date, dispatch number, party, material, quantity, unit, and rate are required");
      return false;
    }
    if (Number(form.quantity) <= 0) {
      toast.error("Quantity must be greater than zero");
      return false;
    }
    if (selectedStock && Number(form.quantity) > Number(selectedStock.quantity || 0) + 1e-9) {
      toast.error(`Quantity exceeds available stock of ${selectedStock.quantity} ${selectedStock.unit}`);
      return false;
    }
    if (Number(form.rate) <= 0) {
      toast.error("Rate must be greater than zero");
      return false;
    }
    return true;
  };

  const saveForm = async () => {
    if (!validateForm()) return;

    const payload = {
      date: form.date,
      dispatch_no: form.dispatch_no.trim(),
      vendor_id: form.vendor_id,
      material_name: form.material_name,
      quantity: Number(form.quantity),
      unit: form.unit,
      rate: Number(form.rate),
      purpose: form.purpose,
      status: "Dispatched",
      notes: form.notes,
    };

    setSubmitting(true);
    try {
      if (editing) {
        await api.patch(`/material-dispatches/${editing.id}`, payload);
      } else {
        await api.post("/material-dispatches", payload);
      }

      toast.success(editing ? "Material dispatch updated" : "Material dispatch created");
      setDrawerOpen(false);
      setEditing(null);
      setForm(emptyForm);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to save material dispatch");
    } finally {
      setSubmitting(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.delete(`/material-dispatches/${deleteTarget.id}`);
      toast.success("Material dispatch deleted");
      setDeleteTarget(null);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to delete material dispatch");
    }
  };

  const triggerImport = () => fileInputRef.current?.click();

  const handleImport = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await api.post("/import/material-dispatches", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      const created = res.data?.created || 0;
      const errors = res.data?.errors || [];

      if (created > 0) {
        toast.success(`Imported ${created} rows`);
        await load();
      }
      if (errors.length) {
        toast.warning(`${errors.length} rows had errors`);
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || "Import failed");
    } finally {
      setImportBusy(false);
      event.target.value = "";
    }
  };

  const exportExcel = async () => {
    try {
      const res = await api.get("/export/material-dispatches", { responseType: "blob" });
      const blob = new Blob(
        [res.data],
        { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `material_dispatches_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Excel exported");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Export failed");
    }
  };

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter((item) => {
      const vendorName = vendorMap[item.vendor_id] || "";
      const matchesSearch = !term || [
        item.dispatch_no,
        vendorName,
        item.material_name,
        item.unit,
        item.purpose,
        item.notes,
        item.status,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(term);

      const matchesStatus = statusFilter === "all" || item.status === statusFilter;
      const matchesVendor = vendorFilter === "all" || item.vendor_id === vendorFilter;

      return matchesSearch && matchesStatus && matchesVendor;
    });
  }, [items, search, statusFilter, vendorFilter, vendorMap]);

  const sorted = useMemo(() => {
    const data = [...filtered];
    data.sort((a, b) => {
      const av = a[sortBy];
      const bv = b[sortBy];

      if (sortBy === "date") {
        const da = av ? new Date(av).getTime() : 0;
        const db = bv ? new Date(bv).getTime() : 0;
        return sortDir === "asc" ? da - db : db - da;
      }

      if (["quantity"].includes(sortBy)) {
        const na = Number(av || 0);
        const nb = Number(bv || 0);
        return sortDir === "asc" ? na - nb : nb - na;
      }

      const sa = String(av || "").toLowerCase();
      const sb = String(bv || "").toLowerCase();
      if (sa < sb) return sortDir === "asc" ? -1 : 1;
      if (sa > sb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return data;
  }, [filtered, sortBy, sortDir]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, vendorFilter, sortBy, sortDir, pageSize]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pageRows = sorted.slice(pageStart, pageStart + pageSize);

  const summary = useMemo(() => {
    return items.reduce(
      (acc, item) => {
        acc.totalDispatches += 1;
        acc.totalQuantity += Number(item.quantity || 0);
        if ((item.status || "").toLowerCase() === "dispatched") {
          acc.activeDispatches += 1;
        }
        return acc;
      },
      { totalDispatches: 0, totalQuantity: 0, activeDispatches: 0 },
    );
  }, [items]);

  const toggleSort = (key) => {
    if (sortBy === key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(key);
    setSortDir("asc");
  };

  const renderSortIcon = (key) => {
    if (sortBy !== key) return <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />;
    return sortDir === "asc"
      ? <ArrowUp className="h-3.5 w-3.5 text-slate-700" />
      : <ArrowDown className="h-3.5 w-3.5 text-slate-700" />;
  };

  return (
    <div data-testid="material-dispatch-page">
      <PageHeader
        title="Material Dispatch"
        subtitle="Dispatch accessories and consumables to parties and company units."
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button data-testid="add-material-dispatch-btn" onClick={openNew} className="bg-slate-900 hover:bg-slate-800">
              <Plus className="mr-2 h-4 w-4" /> Add Dispatch
            </Button>
            <Button type="button" variant="outline" onClick={exportExcel} className="border-slate-300" data-testid="dispatch-export-btn">
              <Download className="mr-2 h-4 w-4" /> Export
            </Button>
            <Button type="button" variant="outline" onClick={triggerImport} className="border-slate-300" data-testid="dispatch-import-btn" disabled={importBusy}>
              <Upload className="mr-2 h-4 w-4" /> {importBusy ? "Importing..." : "Import"}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={handleImport}
              className="hidden"
            />
          </div>
        }
      />

      <Card className="rounded-md border border-slate-200 bg-white p-3 shadow-sm sticky top-0 z-20">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search dispatch"
            className="h-9 w-[280px] border-slate-200"
          />

          <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-600">
            <Filter className="h-3.5 w-3.5" />
            Filter
          </div>

          <select
            value={vendorFilter}
            onChange={(e) => setVendorFilter(e.target.value)}
            className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
          >
            <option value="all">All Parties</option>
            {vendors.map((vendor) => (
              <option key={vendor.id} value={vendor.id}>{vendor.name}</option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
          >
            <option value="all">All Status</option>
            {statusOptions.map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>

          <select
            value={`${sortBy}:${sortDir}`}
            onChange={(e) => {
              const [key, dir] = e.target.value.split(":");
              setSortBy(key);
              setSortDir(dir);
            }}
            className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
          >
            <option value="date:desc">Date (Newest)</option>
            <option value="date:asc">Date (Oldest)</option>
            <option value="dispatch_no:asc">Dispatch No (A-Z)</option>
            <option value="material_name:asc">Material (A-Z)</option>
            <option value="quantity:desc">Quantity (High-Low)</option>
          </select>
        </div>
      </Card>

      <Card className="mt-3 overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
        <Table className="text-sm">
          <TableHeader>
            <TableRow className="bg-slate-50 hover:bg-slate-50">
              <TableHead className="sticky top-0 z-10 bg-slate-50 whitespace-nowrap">S.No</TableHead>
              {[
                ["date", "Date"],
                ["dispatch_no", "Dispatch No"],
                ["vendor_id", "Party / Company Name"],
                ["material_name", "Material Name"],
                ["quantity", "Quantity"],
                ["unit", "Unit"],
                ["rate", "Rate"],
                ["amount", "Amount"],
                ["status", "Status"],
                ["notes", "Notes"],
              ].map(([key, label]) => (
                <TableHead key={key} className="sticky top-0 z-10 bg-slate-50 whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => toggleSort(key)}
                    className="inline-flex items-center gap-1 text-left font-medium text-slate-600 hover:text-slate-900"
                  >
                    {label}
                    {renderSortIcon(key)}
                  </button>
                </TableHead>
              ))}
              <TableHead className="sticky top-0 z-10 bg-slate-50 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={11} className="py-10 text-center text-slate-500">Loading material dispatches...</TableCell>
              </TableRow>
            )}
            {!loading && pageRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={11} className="py-10 text-center text-slate-500">No material dispatch records found.</TableCell>
              </TableRow>
            )}
            {!loading && pageRows.map((row, index) => (
              <TableRow
                key={row.id}
                className={`${index % 2 === 0 ? "bg-white" : "bg-slate-50/40"} hover:bg-slate-100`}
              >
                <TableCell className="font-medium text-slate-700">{pageStart + index + 1}</TableCell>
                <TableCell>{fmtDate(row.date)}</TableCell>
                <TableCell className="font-mono-plex text-xs">{row.dispatch_no || "-"}</TableCell>
                <TableCell>{vendorMap[row.vendor_id] || "Unknown"}</TableCell>
                <TableCell className="font-medium text-slate-900">{row.material_name}</TableCell>
                <TableCell>{Number(row.quantity || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                <TableCell>{row.unit || "-"}</TableCell>
                <TableCell>{fmtMoney(row.rate || 0)}</TableCell>
                <TableCell>{fmtMoney(row.amount || 0)}</TableCell>
                <TableCell>{row.status || "-"}</TableCell>
                <TableCell className="max-w-[220px] truncate" title={row.notes || ""}>{row.notes || "-"}</TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(row)}>
                      <Pencil className="h-4 w-4 text-slate-600" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeleteTarget(row)}
                    >
                      <Trash2 className="h-4 w-4 text-red-600" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-slate-600">
          Showing {pageRows.length ? pageStart + 1 : 0} to {pageStart + pageRows.length} of {sorted.length} records
        </div>

        <div className="flex items-center gap-2">
          <select
            value={String(pageSize)}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs"
          >
            <option value="10">10 / page</option>
            <option value="25">25 / page</option>
            <option value="50">50 / page</option>
          </select>

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={currentPage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </Button>
          <div className="min-w-[84px] text-center text-sm text-slate-700">
            Page {currentPage} / {totalPages}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={currentPage >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
          </Button>
        </div>
      </div>

      <Card className="mt-4 rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Total Dispatches</div>
            <div className="mt-1 text-xl font-semibold text-slate-900">{summary.totalDispatches}</div>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Total Quantity Dispatched</div>
            <div className="mt-1 text-xl font-semibold text-slate-900">
              {summary.totalQuantity.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </div>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Active Dispatches</div>
            <div className="mt-1 text-xl font-semibold text-slate-900">{summary.activeDispatches}</div>
          </div>
        </div>
      </Card>

      <Sheet
        open={drawerOpen}
        onOpenChange={(open) => {
          setDrawerOpen(open);
          if (!open) {
            setEditing(null);
            setForm(emptyForm);
          }
        }}
      >
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader className="border-b border-slate-200 pb-3">
            <SheetTitle className="font-heading text-xl text-slate-900">
              {editing ? "Edit Material Dispatch" : "Add Material Dispatch"}
            </SheetTitle>
            <SheetDescription>
              Dispatch materials and automatically adjust available stock.
            </SheetDescription>
          </SheetHeader>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveForm();
            }}
            className="space-y-4 py-4"
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label>Date *</Label>
                <Input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm((prev) => ({ ...prev, date: e.target.value }))}
                  className="mt-1"
                />
              </div>

              <div>
                <Label>Dispatch No *</Label>
                <Input
                  value={form.dispatch_no}
                  onChange={(e) => setForm((prev) => ({ ...prev, dispatch_no: e.target.value }))}
                  className="mt-1"
                  placeholder="e.g. MD-20260101-0001"
                />
              </div>

              <div>
                <Label>Party / Company Name *</Label>
                <select
                  value={form.vendor_id}
                  onChange={(e) => setForm((prev) => ({ ...prev, vendor_id: e.target.value }))}
                  className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                >
                  <option value="">Select party</option>
                  {vendors.map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>{vendor.name}</option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2">
                <Label>Material *</Label>
                <Input
                  value={materialSearch}
                  onChange={(e) => setMaterialSearch(e.target.value)}
                  className="mt-1"
                  placeholder="Search material by name or unit"
                />
                <select
                  value={`${form.material_name}||${form.unit}`}
                  onChange={(e) => {
                    const [material_name, unit] = e.target.value.split("||");
                    const entry = stockByMaterial.find((item) => item.material_name === material_name && item.unit === unit);
                    setForm((prev) => ({
                      ...prev,
                      material_name,
                      unit,
                      rate: entry ? String(entry.rate ?? "") : prev.rate,
                    }));
                  }}
                  className="mt-2 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                >
                  <option value="||">Select material</option>
                  {visibleStockEntries.map((entry) => (
                    <option key={`${entry.material_name}||${entry.unit}`} value={`${entry.material_name}||${entry.unit}`}>
                      {entry.material_name} — {entry.quantity.toLocaleString(undefined, { maximumFractionDigits: 2 })} {entry.unit} available @ {fmtMoney(entry.rate || 0)}
                    </option>
                  ))}
                </select>
                {selectedStock ? (
                  <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                    Available stock: {selectedStock.quantity.toLocaleString(undefined, { maximumFractionDigits: 2 })} {selectedStock.unit} at {fmtMoney(selectedStock.rate || 0)}
                  </div>
                ) : null}
              </div>

              <div>
                <Label>Quantity *</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.quantity}
                  onChange={(e) => setForm((prev) => ({ ...prev, quantity: e.target.value }))}
                  className="mt-1"
                />
              </div>

              <div>
                <Label>Unit *</Label>
                <Input
                  value={form.unit}
                  onChange={(e) => setForm((prev) => ({ ...prev, unit: e.target.value }))}
                  className="mt-1"
                />
              </div>

              <div>
                <Label>Rate *</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.rate}
                  onChange={(e) => setForm((prev) => ({ ...prev, rate: e.target.value }))}
                  className="mt-1"
                />
              </div>

              <div>
                <Label>Amount</Label>
                <Input value={fmtMoney(computedAmount)} className="mt-1 bg-slate-50" readOnly />
              </div>

              <div>
                <Label>Purpose</Label>
                <Input
                  value={form.purpose}
                  onChange={(e) => setForm((prev) => ({ ...prev, purpose: e.target.value }))}
                  className="mt-1"
                />
              </div>

              <div className="md:col-span-2">
                <Label>Notes</Label>
                <Textarea
                  value={form.notes}
                  onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                  className="mt-1 min-h-[90px]"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDrawerOpen(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="bg-slate-900 hover:bg-slate-800"
                disabled={submitting}
              >
                {submitting ? "Saving..." : "Save"}
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Material Dispatch</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The dispatched quantity will be restored back to material inventory.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
