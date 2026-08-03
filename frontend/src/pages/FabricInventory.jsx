import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api, fmtDate } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Download } from "lucide-react";
import CsvImportButton from "@/components/CsvImportButton";
import UniversalPrintButton from "@/components/erp/UniversalPrintButton";

const STORAGE_KEY = "fabric_inventory_ui_state";
const UNIT_OPTIONS = ["kg", "meter", "yard", "pieces"];

const empty = {
  fabric_type: "",
  color: "",
  supplier: "",
  received_quantity: "",
  cost_per_unit: "",
  unit: "kg",
  rolls: "",
  date_received: "",
  notes: "",
};

const readPersisted = () => {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}") || {};
  } catch {
    return {};
  }
};

const writePersisted = (value) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
};

const formatQty = (value, unit = "kg") => `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${unit || "kg"}`;

const formatCost = (value, unit = "kg") => `₹${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} / ${unit || "kg"}`;
const notifyFabricDataChanged = () => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("fabric-data-updated"));
};

export default function FabricInventory() {
  const [lots, setLots] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState("");
  const [unitFilter, setUnitFilter] = useState("all");
  const [selectedPrintIds, setSelectedPrintIds] = useState([]);

  const hydrateLot = (row) => {
    const persisted = readPersisted();
    const meta = persisted[row.id] || {};
    const unit = meta.unit || row.unit || "kg";
    const receivedQuantity = meta.received_quantity ?? row.kg_received ?? 0;
    const availableQuantity = meta.available_quantity ?? receivedQuantity;
    const rolls = meta.rolls ?? row.rolls ?? 0;
    const availableRolls = meta.available_rolls ?? rolls;
    const costPerUnit = meta.cost_per_unit ?? row.cost_per_kg ?? 0;

    return {
      ...row,
      unit,
      received_quantity: receivedQuantity,
      available_quantity: availableQuantity,
      rolls,
      available_rolls: availableRolls,
      cost_per_unit: costPerUnit,
    };
  };

  const load = useCallback(async () => {
    const res = await api.get("/fabric-lots", { params: { include_archived: showArchived } });
    setLots(res.data.map(hydrateLot));
  }, [showArchived]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
  }, [load]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const handleRefresh = () => load();
    window.addEventListener("fabric-data-updated", handleRefresh);
    return () => window.removeEventListener("fabric-data-updated", handleRefresh);
  }, [load]);

  const openNew = () => {
    setEditing(null);
    setForm({ ...empty, unit: "kg" });
    setOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setForm({
      fabric_type: row.fabric_type,
      color: row.color || "",
      supplier: row.supplier || "",
      received_quantity: String(row.received_quantity ?? row.kg_received ?? 0),
      cost_per_unit: String(row.cost_per_unit ?? row.cost_per_kg ?? 0),
      unit: row.unit || "kg",
      rolls: String(row.rolls ?? 0),
      date_received: row.date_received || "",
      notes: row.notes || "",
    });
    setOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.fabric_type || !form.received_quantity) return toast.error("Fabric type and received quantity are required");

    const receivedQuantity = parseFloat(form.received_quantity);
    const rolls = parseFloat(form.rolls || 0);
    const costPerUnit = parseFloat(form.cost_per_unit || 0);
    const payload = {
      fabric_type: form.fabric_type,
      color: form.color,
      supplier: form.supplier,
      kg_received: receivedQuantity,
      cost_per_kg: costPerUnit,
      date_received: form.date_received || undefined,
      notes: form.notes,
    };

    try {
      let savedRow;
      if (editing) {
        await api.patch(`/fabric-lots/${editing.id}`, payload);
        savedRow = editing;
      } else {
        const res = await api.post("/fabric-lots", payload);
        savedRow = res.data;
      }

      const persisted = readPersisted();
      persisted[savedRow.id] = {
        unit: form.unit || "kg",
        received_quantity: receivedQuantity,
        available_quantity: receivedQuantity,
        rolls,
        available_rolls: rolls,
        cost_per_unit: costPerUnit,
      };
      writePersisted(persisted);

      setForm({ ...empty, unit: "kg" });
      setEditing(null);
      setOpen(false);
      load();
      notifyFabricDataChanged();
      toast.success(editing ? "Fabric lot updated" : "Fabric lot added");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed");
    }
  };

  const removeLot = async (row) => {
    if (!window.confirm("Delete this fabric lot?")) return;
    try {
      await api.delete(`/fabric-lots/${row.id}`);
      const persisted = readPersisted();
      delete persisted[row.id];
      writePersisted(persisted);
      load();
      notifyFabricDataChanged();
      toast.success("Fabric lot deleted");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed");
    }
  };

  const filteredLots = useMemo(() => {
    const term = search.trim().toLowerCase();
    return lots.filter((lot) => {
      const matchesSearch = !term || [lot.fabric_type, lot.color, lot.supplier, lot.notes]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(term);
      const matchesUnit = unitFilter === "all" || lot.unit === unitFilter;
      return matchesSearch && matchesUnit;
    });
  }, [lots, search, unitFilter]);

  const summary = useMemo(() => {
    const totalAvailableQuantity = lots.reduce((sum, lot) => sum + Number(lot.available_quantity ?? lot.received_quantity ?? 0), 0);
    const totalAvailableRolls = lots.reduce((sum, lot) => sum + Number(lot.available_rolls ?? lot.rolls ?? 0), 0);
    const totalFabricValue = lots.reduce((sum, lot) => sum + (Number(lot.available_quantity ?? lot.received_quantity ?? 0) * Number(lot.cost_per_unit ?? lot.cost_per_kg ?? 0)), 0);
    return {
      totalLots: lots.length,
      totalAvailableQuantity,
      totalAvailableRolls,
      totalFabricValue,
    };
  }, [lots]);

  return (
    <div data-testid="fabric-inventory-page" className="min-h-screen bg-slate-50 px-5 py-4">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Fabric Purchase</h1>
            <p className="mt-1 text-sm text-slate-500">Manage incoming fabric lots and auto-create linked supplier payables.</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setEditing(null); setForm({ ...empty, unit: "kg" }); } }}>
              <DialogTrigger asChild>
                <Button data-testid="add-fabric-btn" onClick={openNew} className="h-9 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800">
                  <Plus className="mr-2 h-4 w-4" /> Receive Fabric
                </Button>
              </DialogTrigger>
              <DialogContent className="w-[540px] max-w-[92vw] rounded-[14px] border border-slate-200 p-0 shadow-xl">
                <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                  <h2 className="text-[15px] font-semibold tracking-tight text-slate-900">{editing ? "Edit Fabric Receipt" : "Receive Fabric"}</h2>
                </div>
                <form onSubmit={submit} className="space-y-3 px-4 py-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <Label>Fabric Type</Label>
                      <Input data-testid="fabric-type-input" value={form.fabric_type} onChange={(e) => setForm({ ...form, fabric_type: e.target.value })} placeholder="Search fabric" className="mt-1 h-9 rounded-lg border-slate-200" />
                    </div>
                    <div>
                      <Label>Colour</Label>
                      <Input data-testid="fabric-color-input" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="mt-1 h-9 rounded-lg border-slate-200" />
                    </div>
                    <div>
                      <Label>Supplier</Label>
                      <Input data-testid="fabric-supplier-input" value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} className="mt-1 h-9 rounded-lg border-slate-200" />
                    </div>
                    <div>
                      <Label>Received Quantity</Label>
                      <Input data-testid="fabric-kg-input" type="number" step="0.01" value={form.received_quantity} onChange={(e) => setForm({ ...form, received_quantity: e.target.value })} className="mt-1 h-9 rounded-lg border-slate-200" />
                    </div>
                    <div>
                      <Label>Unit</Label>
                      <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700">
                        {UNIT_OPTIONS.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label>Rolls</Label>
                      <Input type="number" value={form.rolls} onChange={(e) => setForm({ ...form, rolls: e.target.value })} className="mt-1 h-9 rounded-lg border-slate-200" />
                    </div>
                    <div>
                      <Label>Cost / Unit</Label>
                      <Input type="number" step="0.01" value={form.cost_per_unit} onChange={(e) => setForm({ ...form, cost_per_unit: e.target.value })} className="mt-1 h-9 rounded-lg border-slate-200" />
                    </div>
                    <div>
                      <Label>Date Received</Label>
                      <Input type="date" value={form.date_received} onChange={(e) => setForm({ ...form, date_received: e.target.value })} className="mt-1 h-9 rounded-lg border-slate-200" />
                    </div>
                    <div className="md:col-span-2">
                      <Label>Notes</Label>
                      <Textarea data-testid="fabric-notes-input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="mt-1 min-h-[80px] rounded-lg border-slate-200" />
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-3">
                    <Button type="button" variant="outline" onClick={() => setOpen(false)} className="h-9 rounded-lg border-slate-200 px-3 text-sm">Cancel</Button>
                    <Button data-testid="fabric-submit-btn" type="submit" className="h-9 rounded-lg bg-slate-900 px-3 text-sm text-white hover:bg-slate-800">Save</Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
            <div className="flex gap-2">
              <CsvImportButton
                endpoint="/import/fabric-lots"
                label="Import"
                columns={["fabric_type", "color", "supplier", "kg_received", "cost_per_kg", "date_received", "notes"]}
                sampleFilename="fabric_lots_sample.csv"
                testid="fabric-csv-import"
                onDone={load}
              />
              <Button type="button" variant="outline" className="h-9 rounded-lg border-slate-200 px-3 text-sm">
                <Download className="mr-2 h-4 w-4" /> Export
              </Button>
              <UniversalPrintButton
                moduleName="Fabric Purchase"
                rows={filteredLots}
                columns={[
                  { key: "fabric_type", label: "Fabric Type" },
                  { key: "color", label: "Colour" },
                  { key: "supplier", label: "Supplier" },
                  { key: "received_quantity", label: "Received" },
                  { key: "rolls", label: "Rolls" },
                  { key: "available_quantity", label: "Available Qty" },
                ]}
                summary={[
                  { label: "Total Available Quantity", value: formatQty(summary.totalAvailableQuantity, unitFilter !== "all" ? unitFilter : "kg") },
                  { label: "Total Available Rolls", value: summary.totalAvailableRolls },
                ]}
                reportTitle="Fabric Purchase Register"
                reportPeriod={search || "All Fabric Purchase"}
                selectedRows={filteredLots.filter((lot) => selectedPrintIds.includes(lot.id))}
                filteredRows={filteredLots}
                allRows={lots}
                selectedIds={selectedPrintIds}
                onSelectedIdsChange={setSelectedPrintIds}
              />
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search fabric" className="h-9 w-56 rounded-lg border-slate-200" />
            <select value={unitFilter} onChange={(e) => setUnitFilter(e.target.value)} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700">
              <option value="all">All Units</option>
              {UNIT_OPTIONS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
            <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
              <Switch data-testid="show-archived-toggle" checked={showArchived} onCheckedChange={setShowArchived} />
              Show archived
            </label>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500">Total Fabric in Inventory</div>
            <div className="mt-2 text-xl font-semibold text-slate-900">{summary.totalLots}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500">Total Available Quantity</div>
            <div className="mt-2 text-xl font-semibold text-slate-900">{formatQty(summary.totalAvailableQuantity, unitFilter !== "all" ? unitFilter : "kg")}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500">Total Available Rolls</div>
            <div className="mt-2 text-xl font-semibold text-slate-900">{summary.totalAvailableRolls}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500">Total Fabric Value</div>
            <div className="mt-2 text-xl font-semibold text-slate-900">₹{Number(summary.totalFabricValue || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
          </div>
        </div>

        <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {filteredLots.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-slate-500">No fabric records found.</div>
          ) : (
            <Table data-testid="fabric-lots-table" className="text-sm">
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="w-10">
                    <input type="checkbox" checked={selectedPrintIds.length > 0 && selectedPrintIds.length === filteredLots.length} onChange={() => {
                      setSelectedPrintIds((prev) => (prev.length === filteredLots.length && filteredLots.every((lot) => prev.includes(lot.id)) ? [] : filteredLots.map((lot) => lot.id)));
                    }} />
                  </TableHead>
                  <TableHead className="w-12">S.No</TableHead>
                  <TableHead>Date Received</TableHead>
                  <TableHead>Fabric Type</TableHead>
                  <TableHead>Colour</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Received</TableHead>
                  <TableHead>Rolls</TableHead>
                  <TableHead>Available Qty</TableHead>
                  <TableHead>Available Rolls</TableHead>
                  <TableHead>Cost / Unit</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLots.map((lot, index) => (
                  <TableRow key={lot.id} className={lot.archived ? "opacity-60" : ""} data-testid={`fabric-row-${lot.id}`}>
                    <TableCell>
                      <input type="checkbox" checked={selectedPrintIds.includes(lot.id)} onChange={() => {
                        setSelectedPrintIds((prev) => (prev.includes(lot.id) ? prev.filter((id) => id !== lot.id) : [...prev, lot.id]));
                      }} />
                    </TableCell>
                    <TableCell className="font-medium text-slate-700">{index + 1}</TableCell>
                    <TableCell>{fmtDate(lot.date_received)}</TableCell>
                    <TableCell className="font-medium">{lot.fabric_type}</TableCell>
                    <TableCell>{lot.color || "—"}</TableCell>
                    <TableCell>{lot.supplier || "—"}</TableCell>
                    <TableCell>{formatQty(lot.received_quantity, lot.unit)}</TableCell>
                    <TableCell>{lot.rolls || 0}</TableCell>
                    <TableCell>{formatQty(lot.available_quantity, lot.unit)}</TableCell>
                    <TableCell>{lot.available_rolls ?? lot.rolls ?? 0}</TableCell>
                    <TableCell>{formatCost(lot.cost_per_unit, lot.unit)}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button data-testid={`edit-fabric-${lot.id}`} variant="ghost" size="icon" onClick={() => openEdit(lot)}>
                          <Pencil className="h-4 w-4 text-slate-600" />
                        </Button>
                        <Button data-testid={`delete-fabric-${lot.id}`} variant="ghost" size="icon" onClick={() => removeLot(lot)}>
                          <Trash2 className="h-4 w-4 text-rose-600" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </div>
  );
}
