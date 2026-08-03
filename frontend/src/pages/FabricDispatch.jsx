import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";
import { api, fmtNum } from "@/lib/api";
import PageHeader from "@/components/erp/PageHeader";
import PageContainer from "@/components/erp/PageContainer";
import SectionCard from "@/components/erp/SectionCard";
import TableContainer from "@/components/erp/TableContainer";
import PrimaryButton from "@/components/erp/PrimaryButton";
import SecondaryButton from "@/components/erp/SecondaryButton";
import SearchBar from "@/components/erp/SearchBar";
import EmptyState from "@/components/erp/EmptyState";
import UniversalPrintButton from "@/components/erp/UniversalPrintButton";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Plus, Pencil, Trash2, ChevronDown, Eye } from "lucide-react";

const INVENTORY_META_KEY = "fabric_inventory_ui_state";
const PAGE_SIZE = 8;

const defaultHeader = {
  dispatchNo: "",
  date: new Date().toISOString().slice(0, 10),
  vendorId: "",
  expectedReturnDate: "",
  expectedPieces: "",
  remarks: "",
};

const defaultRow = {
  fabricName: "",
  fabricLotId: "",
  brandName: "",
  productType: "",
  quantity: "",
  rolls: "",
  notes: "",
  unit: "",
  availableQuantity: "",
  availableRolls: "",
};

const readInventoryMeta = () => {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(INVENTORY_META_KEY) || "{}") || {};
  } catch {
    return {};
  }
};

const writeInventoryMeta = (value) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(INVENTORY_META_KEY, JSON.stringify(value));
};

const notifyFabricDataChanged = () => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("fabric-data-updated"));
};

const serializeDispatchNote = (header, rows) => {
  const totalPieces = rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  return JSON.stringify({
    dispatchNo: header.dispatchNo,
    date: header.date,
    vendorId: header.vendorId,
    expectedReturnDate: header.expectedReturnDate,
    remarks: header.remarks,
    expectedPieces: Number.isFinite(totalPieces) ? totalPieces : 0,
    lines: rows
      .filter((row) => row.fabricLotId || row.fabricName || row.brandName || row.productType || row.quantity || row.rolls)
      .map((row) => ({
        fabricName: row.fabricName || "",
        fabricLotId: row.fabricLotId || "",
        brandName: row.brandName || "",
        productType: row.productType || "",
        quantity: row.quantity || "",
        rolls: row.rolls || "",
        notes: row.notes || "",
        unit: row.unit || "",
        availableQuantity: row.availableQuantity || "",
        availableRolls: row.availableRolls || "",
      })),
  });
};

const parseDispatchNote = (notes) => {
  try {
    if (!notes) return { dispatchNo: "", date: "", expectedReturnDate: "", remarks: "", lines: [] };
    const parsed = JSON.parse(notes);
    if (parsed && typeof parsed === "object") {
      return {
        dispatchNo: parsed.dispatchNo || "",
        date: parsed.date || "",
        expectedReturnDate: parsed.expectedReturnDate || "",
        remarks: parsed.remarks || "",
        expectedPieces: parsed.expectedPieces || parsed.expected_pieces || "",
        lines: Array.isArray(parsed.lines) ? parsed.lines : [],
      };
    }
  } catch {
    // fall back to legacy notes parsing
  }

  const parts = String(notes).split("|").map((part) => part.trim()).filter(Boolean);
  const data = { dispatchNo: "", date: "", expectedReturnDate: "", remarks: "", lines: [] };
  parts.forEach((part) => {
    if (part.startsWith("Dispatch No:")) data.dispatchNo = part.replace("Dispatch No:", "").trim();
    else if (part.startsWith("Date:")) data.date = part.replace("Date:", "").trim();
    else if (part.startsWith("Expected Return:")) data.expectedReturnDate = part.replace("Expected Return:", "").trim();
    else if (part.startsWith("Remarks:")) data.remarks = part.replace("Remarks:", "").trim();
    else if (part.startsWith("Lines:")) {
      const lineText = part.replace("Lines:", "").trim();
      if (lineText) {
        data.lines = lineText.split("||").map((line) => ({
          fabricName: line.split("/")[0] || "",
          brandName: line.split("/")[1] || "",
          productType: line.split("/")[2] || "",
          quantity: line.split("/")[3] || "",
          rolls: line.split("/")[4] || "",
          notes: line.split("/")[5] || "",
        }));
      }
    }
  });
  return data;
};

function FabricLotSelector({ value, options, onSelect }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((option) => option.lot.id === value) || null;
  const filteredOptions = options.filter((option) => {
    const term = query.trim().toLowerCase();
    if (!term) return true;
    return [option.label, option.lot.fabric_type, option.lot.supplier, option.lot.color]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(term);
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="h-9 w-full justify-between rounded-lg border-slate-200 px-3 text-left text-sm font-normal">
          <span className="truncate">{selected ? selected.label : "Select fabric lot"}</span>
          <ChevronDown className="ml-2 h-4 w-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search fabric stock" value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>No fabric stock found.</CommandEmpty>
            <CommandGroup>
              {filteredOptions.map((option) => (
                <CommandItem
                  key={option.lot.id}
                  value={option.lot.id}
                  onSelect={() => {
                    onSelect(option.lot);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <div className="flex flex-col gap-0.5">
                    <div className="font-medium text-slate-800">{option.label}</div>
                    <div className="text-xs text-slate-500">{option.subLabel}</div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default function FabricDispatchPage() {
  const location = useLocation();
  const [items, setItems] = useState([]);
  const [lots, setLots] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [header, setHeader] = useState(defaultHeader);
  const [rows, setRows] = useState([defaultRow]);
  const [editing, setEditing] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState("");
  const [dirty, setDirty] = useState(false);
  const [validationError, setValidationError] = useState("");
  const [page, setPage] = useState(1);
  const [viewingRecord, setViewingRecord] = useState(null);
  const [selectedPrintIds, setSelectedPrintIds] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [dispatches, fabricLots, vendorsResponse] = await Promise.all([
        api.get("/fabric-dispatches", { params: { include_archived: showArchived } }),
        api.get("/fabric-lots", { params: { include_archived: true } }),
        api.get("/vendors", { params: { include_archived: true } }),
      ]);

      const inventoryMeta = readInventoryMeta();
      const enrichedLots = fabricLots.data
        .map((lot) => {
          const meta = inventoryMeta[lot.id] || {};
          const originalQuantity = Number(meta.original_quantity ?? meta.received_quantity ?? lot.kg_received ?? 0);
          const originalRolls = Number(meta.original_rolls ?? meta.rolls ?? 0);
          const availableQuantity = Number(meta.available_quantity ?? originalQuantity);
          const availableRolls = Number(meta.available_rolls ?? originalRolls);
          return {
            ...lot,
            unit: meta.unit || lot.unit || "kg",
            original_quantity: originalQuantity,
            original_rolls: originalRolls,
            available_quantity: availableQuantity,
            available_rolls: availableRolls,
          };
        })
        .filter((lot) => (showArchived ? true : !lot.archived));

      setItems(dispatches.data);
      setLots(enrichedLots);
      setVendors(vendorsResponse.data);
      setPage(1);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Unable to load fabric dispatches");
    } finally {
      setLoading(false);
    }
  }, [showArchived]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const handleRefresh = () => load();
    window.addEventListener("fabric-data-updated", handleRefresh);
    return () => window.removeEventListener("fabric-data-updated", handleRefresh);
  }, [load]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const searchText = params.get("search") || "";
    if (searchText) {
      setSearch(searchText);
      setPage(1);
    }
  }, [location.search]);

  const resetModal = () => {
    setHeader(defaultHeader);
    setRows([defaultRow]);
    setDirty(false);
    setEditing(null);
    setValidationError("");
  };

  const openNew = () => {
    resetModal();
    setOpen(true);
  };

  const openEdit = (record) => {
    const parsed = parseDispatchNote(record.notes || "{}");
    const firstLine = parsed.lines?.[0] || {};
    setEditing(record);
    setHeader({
      dispatchNo: parsed.dispatchNo || "",
      date: parsed.date || new Date().toISOString().slice(0, 10),
      vendorId: record.vendor_id || "",
      expectedReturnDate: parsed.expectedReturnDate || "",
      expectedPieces: record.expected_pieces != null ? String(record.expected_pieces) : parsed.expectedPieces || "",
      remarks: parsed.remarks || "",
    });
    setRows(
      (parsed.lines || []).length
        ? parsed.lines.map((line) => ({
            fabricName: line.fabricName || "",
            fabricLotId: line.fabricLotId || "",
            brandName: line.brandName || "",
            productType: line.productType || "",
            quantity: line.quantity || "",
            rolls: line.rolls || "",
            notes: line.notes || "",
            unit: line.unit || "",
            availableQuantity: line.availableQuantity || "",
            availableRolls: line.availableRolls || "",
          }))
        : [
            {
              ...defaultRow,
              fabricName: firstLine.fabricName || "",
              fabricLotId: firstLine.fabricLotId || "",
              brandName: firstLine.brandName || "",
              productType: firstLine.productType || "",
              quantity: firstLine.quantity || "",
              rolls: firstLine.rolls || "",
              avgFabricPerPiece: firstLine.avgFabricPerPiece || "",
              notes: firstLine.notes || "",
              unit: firstLine.unit || "",
              availableQuantity: firstLine.availableQuantity || "",
              availableRolls: firstLine.availableRolls || "",
            },
          ]
    );
    setDirty(false);
    setOpen(true);
  };

  const requestClose = (nextOpen) => {
    if (!nextOpen && dirty) {
      const proceed = window.confirm("You have unsaved changes. Close without saving?");
      if (!proceed) return;
    }
    setOpen(nextOpen);
    if (!nextOpen) {
      resetModal();
    }
  };

  const updateHeader = (field, value) => {
    setDirty(true);
    setHeader((prev) => ({ ...prev, [field]: value }));
  };

  const updateRow = (index, field, value) => {
    setDirty(true);
    setRows((prev) => prev.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row)));
  };

  const selectFabricLot = (index, lot) => {
    setDirty(true);
    setRows((prev) => prev.map((row, rowIndex) => (rowIndex === index ? {
      ...row,
      fabricName: lot.fabric_type || "",
      fabricLotId: lot.id,
      brandName: row.brandName || "",
      productType: row.productType || "",
      unit: lot.unit || "kg",
      availableQuantity: Number(lot.available_quantity ?? lot.kg_received ?? 0),
      availableRolls: Number(lot.available_rolls ?? lot.rolls ?? 0),
    } : row)));
  };

  const addRow = () => {
    setDirty(true);
    setRows((prev) => [...prev, { ...defaultRow }]);
  };

  const removeRow = (index) => {
    setDirty(true);
    setRows((prev) => prev.filter((_, rowIndex) => rowIndex !== index));
  };

  const submit = async (e) => {
    e.preventDefault();
    const lineItems = rows.filter((row) => row.fabricLotId || row.fabricName || row.quantity || row.rolls);
    if (!header.dispatchNo.trim()) {
      setValidationError("Enter a manual dispatch number.");
      toast.error("Enter a manual dispatch number.");
      return;
    }
    if (!header.vendorId) {
      setValidationError("Select a vendor before saving.");
      toast.error("Select a vendor before saving.");
      return;
    }
    if (!lineItems.length) {
      setValidationError("Add at least one fabric line item.");
      toast.error("Add at least one fabric line item.");
      return;
    }

    const issues = [];
    lineItems.forEach((row, index) => {
      if (!row.fabricLotId) {
        issues.push(`Line ${index + 1}: select a fabric lot.`);
        return;
      }
      const lot = lots.find((item) => item.id === row.fabricLotId);
      const availableQuantity = Number(lot?.available_quantity ?? lot?.kg_received ?? 0);
      const availableRolls = Number(lot?.available_rolls ?? lot?.rolls ?? 0);
      const quantity = Number(row.quantity || 0);
      const rolls = Number(row.rolls || 0);
      if (quantity > availableQuantity + 1e-9) {
        issues.push(`Line ${index + 1}: quantity exceeds available stock (${availableQuantity}).`);
      }
      if (rolls > availableRolls + 1e-9) {
        issues.push(`Line ${index + 1}: rolls exceed available rolls (${availableRolls}).`);
      }
    });

    if (issues.length) {
      setValidationError(issues[0]);
      toast.error(issues[0]);
      return;
    }

    const totalQuantity = lineItems.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
    const totalRolls = lineItems.reduce((sum, row) => sum + Number(row.rolls || 0), 0);
    const expectedPiecesValue = Number(header.expectedPieces || 0);
    const payload = {
      fabric_lot_id: lineItems[0].fabricLotId,
      vendor_id: header.vendorId,
      date: header.date || undefined,
      kg_dispatched: totalQuantity,
      expected_pieces: Number.isFinite(expectedPiecesValue) && expectedPiecesValue > 0 ? expectedPiecesValue : 0,
      notes: serializeDispatchNote(header, rows),
    };

    try {
      if (editing) {
        await api.patch(`/fabric-dispatches/${editing.id}`, payload);
        toast.success("Dispatch updated");
      } else {
        const persisted = readInventoryMeta();
        lineItems.forEach((row) => {
          const lotId = row.fabricLotId;
          if (!lotId) return;
          const currentLot = lots.find((item) => item.id === lotId);
          const currentMeta = persisted[lotId] || {};
          const originalQuantity = Number(currentMeta.original_quantity ?? currentMeta.received_quantity ?? currentLot?.original_quantity ?? currentLot?.kg_received ?? 0);
          const originalRolls = Number(currentMeta.original_rolls ?? currentMeta.rolls ?? currentLot?.original_rolls ?? currentLot?.rolls ?? 0);
          const nextQuantity = Math.max(0, Number(currentMeta.available_quantity ?? originalQuantity) - Number(row.quantity || 0));
          const nextRolls = Math.max(0, Number(currentMeta.available_rolls ?? originalRolls) - Number(row.rolls || 0));
          persisted[lotId] = {
            ...currentMeta,
            unit: row.unit || currentMeta.unit || currentLot?.unit || "kg",
            original_quantity: originalQuantity,
            original_rolls: originalRolls,
            received_quantity: originalQuantity,
            available_quantity: nextQuantity,
            rolls: originalRolls,
            available_rolls: nextRolls,
          };
        });
        writeInventoryMeta(persisted);
        await api.post("/fabric-dispatches", payload);
        toast.success("Dispatch saved successfully");
      }
      setDirty(false);
      setOpen(false);
      resetModal();
      load();
      notifyFabricDataChanged();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to save dispatch");
    }
  };

  const deleteDispatch = async (record) => {
    const proceed = window.confirm("Delete this dispatch record?");
    if (!proceed) return;
    try {
      await api.delete(`/fabric-dispatches/${record.id}`);
      toast.success("Dispatch deleted");
      load();
      notifyFabricDataChanged();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Unable to delete dispatch");
    }
  };

  const lotMap = useMemo(() => Object.fromEntries(lots.map((lot) => [lot.id, lot])), [lots]);
  const vendorMap = useMemo(() => Object.fromEntries(vendors.map((vendor) => [vendor.id, vendor])), [vendors]);

  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return items;
    return items.filter((item) => {
      const parsed = parseDispatchNote(item.notes || "{}");
      const vendor = vendorMap[item.vendor_id];
      const content = [parsed.dispatchNo, parsed.remarks, parsed.lines?.map((line) => [line.fabricName, line.brandName, line.productType, line.notes].join(" ")).join(" "), vendor?.name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return content.includes(term);
    });
  }, [items, search, vendorMap]);

  const paginatedItems = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredItems.slice(start, start + PAGE_SIZE);
  }, [filteredItems, page]);

  const fabricOptions = useMemo(() =>
    lots.map((lot) => {
      const availableQuantity = Number(lot.available_quantity ?? lot.kg_received ?? 0);
      const availableRolls = Number(lot.available_rolls ?? lot.rolls ?? 0);
      return {
        label: `${lot.fabric_type || "Unnamed"}`,
        subLabel: `Supplier: ${lot.supplier || "—"} • Available ${availableQuantity.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${lot.unit || "kg"} • ${availableRolls} Rolls`,
        lot,
      };
    }),
    [lots]
  );

  const totalQuantity = useMemo(() => rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0), [rows]);
  const totalRolls = useMemo(() => rows.reduce((sum, row) => sum + Number(row.rolls || 0), 0), [rows]);
  const dispatchSummary = useMemo(() => {
    const totalDispatches = items.length;
    const totalQuantityDispatched = items.reduce((sum, item) => {
      const parsed = parseDispatchNote(item.notes || "{}") || {};
      const lines = Array.isArray(parsed.lines) ? parsed.lines : [];
      const quantity = lines.reduce((lineSum, line) => lineSum + Number(line.quantity || 0), 0);
      return sum + (quantity || Number(item.kg_dispatched || 0));
    }, 0);
    const totalRollsDispatched = items.reduce((sum, item) => {
      const parsed = parseDispatchNote(item.notes || "{}") || {};
      const lines = Array.isArray(parsed.lines) ? parsed.lines : [];
      const rolls = lines.reduce((lineSum, line) => lineSum + Number(line.rolls || 0), 0);
      return sum + rolls;
    }, 0);
    return { totalDispatches, totalQuantityDispatched, totalRollsDispatched };
  }, [items]);

  return (
    <div data-testid="dispatch-page" className="min-h-screen bg-slate-50 px-4 py-4 md:px-6">
      <div className="mx-auto max-w-7xl space-y-4">
        <PageHeader
          title="Fabric Dispatch"
          subtitle="Manage multi-item fabric dispatches with manual dispatch numbers and live inventory visibility"
          eyebrow="Operations"
          actions={
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 shadow-sm">
                <Switch checked={showArchived} onCheckedChange={setShowArchived} />
                Show archived
              </label>
              <Dialog open={open} onOpenChange={requestClose}>
                <DialogTrigger asChild>
                  <PrimaryButton data-testid="add-dispatch-btn" onClick={openNew}>
                    <Plus className="mr-2 h-4 w-4" /> New Dispatch
                  </PrimaryButton>
                </DialogTrigger>
                <DialogContent className="max-h-[92vh] w-[95vw] max-w-7xl overflow-y-auto rounded-[20px] border border-slate-200 bg-white p-0 shadow-2xl">
                  <div className="flex h-full flex-col">
                    <div className="flex-shrink-0 border-b border-slate-200 bg-slate-50 px-6 py-4">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500">Fabric Dispatch</div>
                          <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">{editing ? "Edit Dispatch" : "New Fabric Dispatch"}</h2>
                        </div>
                        <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600">{editing ? "Edit" : "New"}</span>
                      </div>
                    </div>

                    <div className="flex-1 overflow-y-auto bg-slate-50 px-6 py-4">
                      <form onSubmit={submit} className="space-y-3">
                        <div className="rounded-[16px] border border-slate-200 bg-white p-4">
                          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                            <div>
                              <Label>Dispatch S.No.</Label>
                              <Input value={header.dispatchNo} onChange={(e) => updateHeader("dispatchNo", e.target.value)} className="mt-1 h-9 rounded-lg border-slate-200" placeholder="Manual entry" />
                            </div>
                            <div>
                              <Label>Date</Label>
                              <Input type="date" value={header.date} onChange={(e) => updateHeader("date", e.target.value)} className="mt-1 h-9 rounded-lg border-slate-200" />
                            </div>
                            <div>
                              <Label>Vendor</Label>
                              <Select value={header.vendorId} onValueChange={(value) => updateHeader("vendorId", value)}>
                                <SelectTrigger className="mt-1 h-9 rounded-lg border-slate-200">
                                  <SelectValue placeholder="Select vendor" />
                                </SelectTrigger>
                                <SelectContent>
                                  {vendors.map((vendor) => (
                                    <SelectItem key={vendor.id} value={vendor.id}>{vendor.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <Label>Expected Return Date</Label>
                              <Input type="date" value={header.expectedReturnDate} onChange={(e) => updateHeader("expectedReturnDate", e.target.value)} className="mt-1 h-9 rounded-lg border-slate-200" />
                            </div>
                            <div>
                              <Label>Expected Pieces</Label>
                              <Input type="number" value={header.expectedPieces} onChange={(e) => updateHeader("expectedPieces", e.target.value)} className="mt-1 h-9 rounded-lg border-slate-200" placeholder="0" />
                            </div>
                            <div>
                              <Label>Remarks</Label>
                              <Textarea value={header.remarks} onChange={(e) => updateHeader("remarks", e.target.value)} className="mt-1 min-h-[40px] rounded-lg border-slate-200" placeholder="Optional remarks" />
                            </div>
                          </div>
                        </div>

                        <div className="rounded-[16px] border border-slate-200 bg-white p-4">
                          <div className="mb-3 flex items-center justify-between">
                            <div>
                              <div className="text-sm font-semibold text-slate-800">Line Items</div>
                              <div className="text-sm text-slate-500">Dispatch multiple fabrics under one manual dispatch number.</div>
                            </div>
                            <PrimaryButton type="button" onClick={addRow}>
                              <Plus className="mr-2 h-4 w-4" /> Add Item
                            </PrimaryButton>
                          </div>

                          {validationError ? (
                            <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{validationError}</div>
                          ) : null}

                          <div className="overflow-x-auto">
                            <table className="min-w-[1200px] w-full border-separate border-spacing-0 rounded-xl border border-slate-200">
                              <thead className="bg-slate-50">
                                <tr>
                                  {['S.No', 'Fabric Lot', 'Brand Name', 'Product Type', 'Available Qty', 'Available Rolls', 'Qty', 'Rolls', 'Notes', 'Actions'].map((heading) => (
                                    <th key={heading} className="border-b border-slate-200 px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                                      {heading}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {rows.map((row, index) => (
                                  <tr key={`${index}-${row.fabricLotId || row.fabricName || "new"}`} className="border-b border-slate-100 bg-white">
                                    <td className="px-2 py-2 text-sm text-slate-600">{index + 1}</td>
                                    <td className="px-2 py-2">
                                      <FabricLotSelector value={row.fabricLotId} options={fabricOptions} onSelect={(lot) => selectFabricLot(index, lot)} />
                                    </td>
                                    <td className="px-2 py-2"><Input value={row.brandName} onChange={(e) => updateRow(index, "brandName", e.target.value)} className="h-9 rounded-lg border-slate-200" placeholder="Manual brand" /></td>
                                    <td className="px-2 py-2"><Input value={row.productType} onChange={(e) => updateRow(index, "productType", e.target.value)} className="h-9 rounded-lg border-slate-200" placeholder="Manual type" /></td>
                                    <td className="px-2 py-2"><Input value={row.availableQuantity} readOnly className="h-9 rounded-lg border-slate-200 bg-slate-50" /></td>
                                    <td className="px-2 py-2"><Input value={row.availableRolls} readOnly className="h-9 rounded-lg border-slate-200 bg-slate-50" /></td>
                                    <td className="px-2 py-2"><Input type="number" value={row.quantity} onChange={(e) => updateRow(index, "quantity", e.target.value)} className="h-9 rounded-lg border-slate-200" placeholder="0" /></td>
                                    <td className="px-2 py-2"><Input type="number" value={row.rolls} onChange={(e) => updateRow(index, "rolls", e.target.value)} className="h-9 rounded-lg border-slate-200" placeholder="0" /></td>
                                    <td className="px-2 py-2"><Input value={row.notes} onChange={(e) => updateRow(index, "notes", e.target.value)} className="h-9 rounded-lg border-slate-200" placeholder="Optional note" /></td>
                                    <td className="px-2 py-2">
                                      <Button type="button" variant="ghost" size="icon" onClick={() => removeRow(index)}>
                                        <Trash2 className="h-4 w-4 text-rose-600" />
                                      </Button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </form>
                    </div>

                    <div className="flex-shrink-0 border-t border-slate-200 bg-white px-6 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex flex-wrap gap-4 text-sm text-slate-600">
                          <span>Total Quantity: <strong>{totalQuantity}</strong></span>
                          <span>Total Rolls: <strong>{totalRolls}</strong></span>
                        </div>
                        <div className="flex items-center gap-2">
                          <SecondaryButton type="button" onClick={() => requestClose(false)}>Cancel</SecondaryButton>
                          <PrimaryButton type="submit" onClick={submit}>Save Dispatch</PrimaryButton>
                        </div>
                      </div>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          }
        />

        <PageContainer>
          <div className="mb-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500">Total Dispatches</div>
              <div className="mt-2 text-xl font-semibold text-slate-900">{dispatchSummary.totalDispatches}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500">Total Quantity Dispatched</div>
              <div className="mt-2 text-xl font-semibold text-slate-900">{fmtNum(dispatchSummary.totalQuantityDispatched)}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500">Total Rolls Dispatched</div>
              <div className="mt-2 text-xl font-semibold text-slate-900">{fmtNum(dispatchSummary.totalRollsDispatched)}</div>
            </div>
          </div>
          <SectionCard title="Dispatch Register" description="Search, review, and manage fabric dispatches with clear stock visibility.">
            <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <SearchBar value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search dispatches" />
              <div className="flex items-center gap-2">
                <SecondaryButton type="button">Export</SecondaryButton>
                <UniversalPrintButton
                  moduleName="Fabric Dispatch"
                  rows={filteredItems}
                  columns={[
                    { key: "dispatchNo", label: "Dispatch S.No." },
                    { key: "fabric", label: "Fabric" },
                    { key: "productType", label: "Product Type" },
                    { key: "brandName", label: "Brand Name" },
                    { key: "vendor", label: "Vendor" },
                    { key: "quantity", label: "Quantity" },
                    { key: "rolls", label: "Rolls" },
                  ]}
                  summary={[
                    { label: "Total Quantity Dispatched", value: fmtNum(dispatchSummary.totalQuantityDispatched) },
                    { label: "Total Rolls Dispatched", value: fmtNum(dispatchSummary.totalRollsDispatched) },
                  ]}
                  reportTitle="Fabric Dispatch Register"
                  reportPeriod={search || "All Dispatches"}
                  selectedRows={filteredItems.filter((item) => selectedPrintIds.includes(item.id))}
                  currentPageRows={paginatedItems}
                  filteredRows={filteredItems}
                  allRows={items}
                  selectedIds={selectedPrintIds}
                  onSelectedIdsChange={setSelectedPrintIds}
                />
              </div>
            </div>

            {loading ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-600">Loading dispatches…</div>
            ) : filteredItems.length === 0 ? (
              <EmptyState title="No dispatches found" description="Create a new dispatch to start tracking fabric movement and stock consumption." />
            ) : (
              <>
                <TableContainer>
                  <Table data-testid="dispatch-table">
                    <TableHeader>
                      <TableRow className="bg-slate-50">
                        <TableHead className="w-10">
                          <Checkbox checked={selectedPrintIds.length > 0 && selectedPrintIds.length === paginatedItems.length} onCheckedChange={() => {
                            const ids = paginatedItems.map((item) => item.id);
                            setSelectedPrintIds((prev) => (prev.length === ids.length && ids.every((id) => prev.includes(id)) ? [] : ids));
                          }} />
                        </TableHead>
                        <TableHead>S.No</TableHead>
                        <TableHead>Dispatch S.No.</TableHead>
                        <TableHead>Fabric</TableHead>
                        <TableHead>Product Type</TableHead>
                        <TableHead>Brand Name</TableHead>
                        <TableHead>Vendor</TableHead>
                        <TableHead>Qty</TableHead>
                        <TableHead>Rolls</TableHead>
                        <TableHead>Notes</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paginatedItems.map((dispatchItem, index) => {
                        const parsed = parseDispatchNote(dispatchItem.notes || "{}");
                        const line = parsed.lines?.[0] || {};
                        return (
                          <TableRow key={dispatchItem.id} className={dispatchItem.archived ? "opacity-60" : ""} data-testid={`dispatch-row-${dispatchItem.id}`}>
                            <TableCell>
                              <Checkbox checked={selectedPrintIds.includes(dispatchItem.id)} onCheckedChange={() => {
                                setSelectedPrintIds((prev) => (prev.includes(dispatchItem.id) ? prev.filter((id) => id !== dispatchItem.id) : [...prev, dispatchItem.id]));
                              }} />
                            </TableCell>
                            <TableCell>{(page - 1) * PAGE_SIZE + index + 1}</TableCell>
                            <TableCell className="font-medium text-slate-800">{parsed.dispatchNo || "—"}</TableCell>
                            <TableCell>{line.fabricName || "—"}</TableCell>
                            <TableCell>{line.productType || "—"}</TableCell>
                            <TableCell>{line.brandName || "—"}</TableCell>
                            <TableCell>{vendorMap[dispatchItem.vendor_id]?.name || "—"}</TableCell>
                            <TableCell>{line.quantity || dispatchItem.kg_dispatched ? `${fmtNum(line.quantity || dispatchItem.kg_dispatched)} ${line.unit || dispatchItem.unit || "kg"}` : "—"}</TableCell>
                            <TableCell>{line.rolls || "—"}</TableCell>
                            <TableCell className="max-w-[220px] truncate text-slate-600">{line.notes || parsed.remarks || "—"}</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Button type="button" variant="ghost" size="sm" onClick={() => setViewingRecord(dispatchItem)}>
                                  <Eye className="mr-1 h-4 w-4" /> View
                                </Button>
                                <Button type="button" variant="ghost" size="sm" onClick={() => openEdit(dispatchItem)}>
                                  <Pencil className="mr-1 h-4 w-4" /> Edit
                                </Button>
                                <Button type="button" variant="ghost" size="sm" className="text-rose-600" onClick={() => deleteDispatch(dispatchItem)}>
                                  <Trash2 className="mr-1 h-4 w-4" /> Delete
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>

                <div className="mt-4 flex items-center justify-between">
                  <div className="text-sm text-slate-500">Showing {paginatedItems.length} of {filteredItems.length} dispatches</div>
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => setPage((prev) => Math.max(1, prev - 1))} disabled={page === 1}>Previous</Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => setPage((prev) => prev + 1)} disabled={page * PAGE_SIZE >= filteredItems.length}>Next</Button>
                  </div>
                </div>
              </>
            )}
          </SectionCard>
        </PageContainer>
      </div>

      <Dialog open={Boolean(viewingRecord)} onOpenChange={(openValue) => setViewingRecord(openValue ? viewingRecord : null)}>
        <DialogContent className="max-w-xl rounded-[16px] border-slate-200">
          {viewingRecord ? (
            <div className="space-y-3">
              <div className="border-b border-slate-200 pb-3">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Dispatch Details</div>
                <div className="mt-1 text-lg font-semibold text-slate-900">{parseDispatchNote(viewingRecord.notes || "{}").dispatchNo || "Pending dispatch"}</div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                  <div className="text-slate-500">Fabric</div>
                  <div className="font-medium text-slate-800">{parseDispatchNote(viewingRecord.notes || "{}").lines?.[0]?.fabricName || "—"}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                  <div className="text-slate-500">Brand</div>
                  <div className="font-medium text-slate-800">{parseDispatchNote(viewingRecord.notes || "{}").lines?.[0]?.brandName || "—"}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                  <div className="text-slate-500">Quantity</div>
                  <div className="font-medium text-slate-800">{parseDispatchNote(viewingRecord.notes || "{}").lines?.[0]?.quantity || viewingRecord.kg_dispatched || "—"}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                  <div className="text-slate-500">Rolls</div>
                  <div className="font-medium text-slate-800">{parseDispatchNote(viewingRecord.notes || "{}").lines?.[0]?.rolls || "—"}</div>
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                {parseDispatchNote(viewingRecord.notes || "{}").remarks || "No remarks added."}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
