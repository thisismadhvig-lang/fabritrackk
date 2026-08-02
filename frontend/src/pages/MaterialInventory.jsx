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
} from "lucide-react";import UniversalPrintButton from "@/components/erp/UniversalPrintButton";
const emptyForm = {
  date: "",
  material_name: "",
  supplier: "",
  quantity: "",
  unit: "pcs",
  rate: "",
  notes: "",
};

const unitOptions = ["pcs", "kg", "meter", "yard", "roll", "box", "pack"];

export default function MaterialInventory() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  const [search, setSearch] = useState("");
  const [unitFilter, setUnitFilter] = useState("all");
  const [supplierFilter, setSupplierFilter] = useState("all");
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

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get("/material-inventory");
      setItems(res.data || []);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to load material inventory");
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
    setForm({ ...emptyForm, date: new Date().toISOString().slice(0, 10) });
    setDrawerOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setForm({
      date: (row.date || "").slice(0, 10),
      material_name: row.material_name || "",
      supplier: row.supplier || "",
      quantity: String(row.quantity ?? ""),
      unit: row.unit || "pcs",
      rate: String(row.rate ?? ""),
      notes: row.notes || "",
    });
    setDrawerOpen(true);
  };

  const computedAmount = useMemo(() => {
    const q = Number(form.quantity || 0);
    const r = Number(form.rate || 0);
    return q > 0 && r > 0 ? q * r : 0;
  }, [form.quantity, form.rate]);

  const validateForm = () => {
    if (!form.date || !form.material_name || !form.supplier || !form.quantity || !form.rate || !form.unit) {
      toast.error("Date, material name, supplier, quantity, unit, and rate are required");
      return false;
    }
    if (Number(form.quantity) <= 0) {
      toast.error("Quantity must be greater than zero");
      return false;
    }
    if (Number(form.rate) <= 0) {
      toast.error("Rate must be greater than zero");
      return false;
    }
    return true;
  };

  const saveForm = async ({ addAnother = false } = {}) => {
    if (!validateForm()) return;
    const payload = {
      date: form.date,
      material_name: form.material_name.trim(),
      supplier: form.supplier.trim(),
      quantity: Number(form.quantity),
      unit: form.unit,
      rate: Number(form.rate),
      notes: form.notes,
    };

    setSubmitting(true);
    try {
      if (editing) {
        await api.patch(`/material-inventory/${editing.id}`, payload);
      } else {
        await api.post("/material-inventory", payload);
      }

      toast.success(editing ? "Material updated" : "Material added");
      await load();

      if (addAnother && !editing) {
        setForm({ ...emptyForm, date: new Date().toISOString().slice(0, 10) });
      } else {
        setDrawerOpen(false);
        setEditing(null);
        setForm(emptyForm);
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to save material");
    } finally {
      setSubmitting(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.delete(`/material-inventory/${deleteTarget.id}`);
      toast.success("Material deleted");
      setDeleteTarget(null);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to delete material");
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
      const res = await api.post("/import/material-inventory", fd, {
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
      if (!created && !errors.length) {
        toast.info("No rows imported");
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
      const res = await api.get("/export/material-inventory", {
        responseType: "blob",
      });
      const blob = new Blob(
        [res.data],
        { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `material_inventory_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Excel exported");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Export failed");
    }
  };

  const normalizedSuppliers = useMemo(() => {
    const names = new Set();
    items.forEach((item) => {
      if (item.supplier?.trim()) names.add(item.supplier.trim());
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      const matchesSearch = !q || [
        item.material_name,
        item.supplier,
        item.unit,
        item.notes,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);

      const matchesUnit = unitFilter === "all" || item.unit === unitFilter;
      const matchesSupplier = supplierFilter === "all" || item.supplier === supplierFilter;

      return matchesSearch && matchesUnit && matchesSupplier;
    });
  }, [items, search, unitFilter, supplierFilter]);

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

      if (["quantity", "rate", "amount"].includes(sortBy)) {
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
  }, [search, unitFilter, supplierFilter, sortBy, sortDir, pageSize]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pageRows = sorted.slice(pageStart, pageStart + pageSize);

  const summary = useMemo(() => {
    return items.reduce(
      (acc, item) => {
        acc.totalQuantity += Number(item.quantity || 0);
        acc.totalValue += Number(item.amount || 0);
        return acc;
      },
      { totalMaterials: items.length, totalQuantity: 0, totalValue: 0 },
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
    <div data-testid="material-inventory-page">
      <PageHeader
        title="Material Inventory"
        subtitle="Manage all garment accessories and consumables used in production."
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button data-testid="add-material-btn" onClick={openNew} className="bg-slate-900 hover:bg-slate-800">
              <Plus className="mr-2 h-4 w-4" /> Add Material
            </Button>
            <Button type="button" variant="outline" onClick={exportExcel} className="border-slate-300" data-testid="material-export-btn">
              <Download className="mr-2 h-4 w-4" /> Export
            </Button>
            <Button type="button" variant="outline" onClick={triggerImport} className="border-slate-300" data-testid="material-import-btn" disabled={importBusy}>
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
            placeholder="Search material"
            className="h-9 w-[280px] border-slate-200"
            data-testid="material-search"
          />

          <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-600">
            <Filter className="h-3.5 w-3.5" />
            Filter
          </div>

          <select
            value={supplierFilter}
            onChange={(e) => setSupplierFilter(e.target.value)}
            className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
            data-testid="material-supplier-filter"
          >
            <option value="all">All Suppliers</option>
            {normalizedSuppliers.map((supplier) => (
              <option key={supplier} value={supplier}>{supplier}</option>
            ))}
          </select>

          <select
            value={unitFilter}
            onChange={(e) => setUnitFilter(e.target.value)}
            className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
            data-testid="material-unit-filter"
          >
            <option value="all">All Units</option>
            {unitOptions.map((unit) => (
              <option key={unit} value={unit}>{unit}</option>
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
            data-testid="material-sort"
          >
            <option value="date:desc">Date (Newest)</option>
            <option value="date:asc">Date (Oldest)</option>
            <option value="material_name:asc">Material (A-Z)</option>
            <option value="material_name:desc">Material (Z-A)</option>
            <option value="amount:desc">Amount (High-Low)</option>
            <option value="amount:asc">Amount (Low-High)</option>
          </select>
        </div>
      </Card>

      <Card className="mt-3 overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
        <Table data-testid="material-table" className="text-sm">
          <TableHeader>
            <TableRow className="bg-slate-50 hover:bg-slate-50">
              <TableHead className="sticky top-0 z-10 bg-slate-50 whitespace-nowrap">S.No</TableHead>
              {[
                ["date", "Date"],
                ["material_name", "Material Name"],
                ["supplier", "Supplier"],
                ["quantity", "Quantity"],
                ["unit", "Unit"],
                ["rate", "Rate (\u20b9)"],
                ["amount", "Amount (\u20b9)"],
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
                <TableCell colSpan={10} className="py-10 text-center text-slate-500">Loading material inventory...</TableCell>
              </TableRow>
            )}
            {!loading && pageRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="py-10 text-center text-slate-500">No material records found.</TableCell>
              </TableRow>
            )}
            {!loading && pageRows.map((row, index) => (
              <TableRow
                key={row.id}
                className={`${index % 2 === 0 ? "bg-white" : "bg-slate-50/40"} hover:bg-slate-100`}
                data-testid={`material-row-${row.id}`}
              >
                <TableCell className="font-medium text-slate-700">{pageStart + index + 1}</TableCell>
                <TableCell>{fmtDate(row.date)}</TableCell>
                <TableCell className="font-medium text-slate-900">{row.material_name}</TableCell>
                <TableCell>{row.supplier}</TableCell>
                <TableCell>{Number(row.quantity || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                <TableCell>{row.unit || "-"}</TableCell>
                <TableCell>{fmtMoney(row.rate)}</TableCell>
                <TableCell className="font-medium">{fmtMoney(row.amount)}</TableCell>
                <TableCell className="max-w-[220px] truncate" title={row.notes || ""}>{row.notes || "-"}</TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(row)} data-testid={`edit-material-${row.id}`}>
                      <Pencil className="h-4 w-4 text-slate-600" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeleteTarget(row)}
                      data-testid={`delete-material-${row.id}`}
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

      <Card className="mt-4 rounded-md border border-slate-200 bg-white p-4 shadow-sm" data-testid="material-summary">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Total Materials</div>
            <div className="mt-1 text-xl font-semibold text-slate-900">{summary.totalMaterials}</div>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Total Quantity</div>
            <div className="mt-1 text-xl font-semibold text-slate-900">
              {summary.totalQuantity.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </div>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Total Inventory Value</div>
            <div className="mt-1 text-xl font-semibold text-slate-900">{fmtMoney(summary.totalValue)}</div>
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
              {editing ? "Edit Material" : "Add Material"}
            </SheetTitle>
            <SheetDescription>
              Capture accessory and consumable inventory details.
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
                  data-testid="material-date-input"
                />
              </div>
              <div>
                <Label>Material Name *</Label>
                <Input
                  value={form.material_name}
                  onChange={(e) => setForm((prev) => ({ ...prev, material_name: e.target.value }))}
                  className="mt-1"
                  placeholder="e.g. Buttons / Tags / Zipper"
                  data-testid="material-name-input"
                />
              </div>

              <div>
                <Label>Supplier *</Label>
                <Input
                  value={form.supplier}
                  onChange={(e) => setForm((prev) => ({ ...prev, supplier: e.target.value }))}
                  className="mt-1"
                  data-testid="material-supplier-input"
                />
              </div>

              <div>
                <Label>Unit *</Label>
                <select
                  value={form.unit}
                  onChange={(e) => setForm((prev) => ({ ...prev, unit: e.target.value }))}
                  className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                  data-testid="material-unit-input"
                >
                  {unitOptions.map((unit) => (
                    <option key={unit} value={unit}>{unit}</option>
                  ))}
                </select>
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
                  data-testid="material-quantity-input"
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
                  data-testid="material-rate-input"
                />
              </div>

              <div>
                <Label>Amount (Auto)</Label>
                <Input
                  readOnly
                  value={computedAmount.toFixed(2)}
                  className="mt-1 bg-slate-50"
                  data-testid="material-amount-input"
                />
              </div>

              <div className="md:col-span-2">
                <Label>Notes</Label>
                <Textarea
                  value={form.notes}
                  onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                  className="mt-1 min-h-[90px]"
                  data-testid="material-notes-input"
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
              {!editing && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => saveForm({ addAnother: true })}
                  disabled={submitting}
                >
                  Save & Add New
                </Button>
              )}
              <Button
                type="submit"
                className="bg-slate-900 hover:bg-slate-800"
                disabled={submitting}
                data-testid="material-save-btn"
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
            <AlertDialogTitle>Delete Material</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently remove the selected material record.
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
