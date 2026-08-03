import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";
import { api, fmtDate, fmtNum } from "@/lib/api";
import PageHeader from "@/components/erp/PageHeader";
import PageContainer from "@/components/erp/PageContainer";
import SectionCard from "@/components/erp/SectionCard";
import TableContainer from "@/components/erp/TableContainer";
import PrimaryButton from "@/components/erp/PrimaryButton";
import SecondaryButton from "@/components/erp/SecondaryButton";
import SearchBar from "@/components/erp/SearchBar";
import EmptyState from "@/components/erp/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ChevronDown, Download, Eye, Pencil, Printer, Plus, Trash2 } from "lucide-react";
import { getDispatchExpectedPieces as getDispatchExpectedPiecesFromWorkflow, getFabricStillLyingKg } from "@/lib/productionWorkflow";
import UniversalPrintButton from "@/components/erp/UniversalPrintButton";

const roundCurrency = (value) => Number(Number(value || 0).toFixed(2));

const PAGE_SIZE = 8;
const notifyFabricDataChanged = () => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("fabric-data-updated"));
};

const parseDispatchNote = (notes) => {
  try {
    if (!notes) return { dispatchNo: "", date: "", expectedReturnDate: "", remarks: "", lines: [], expectedPieces: "", avgFabricPerPiece: "" };
    const parsed = JSON.parse(notes);
    if (parsed && typeof parsed === "object") {
      return {
        dispatchNo: parsed.dispatchNo || "",
        date: parsed.date || "",
        expectedReturnDate: parsed.expectedReturnDate || "",
        remarks: parsed.remarks || "",
        lines: Array.isArray(parsed.lines) ? parsed.lines : [],
        expectedPieces: parsed.expectedPieces || parsed.expected_pieces || "",
        avgFabricPerPiece: parsed.avgFabricPerPiece || parsed.avg_fabric_per_piece || "",
      };
    }
  } catch {
    // fall back to legacy format if the note is not JSON
  }
  return { dispatchNo: "", date: "", expectedReturnDate: "", remarks: "", lines: [], expectedPieces: "", avgFabricPerPiece: "" };
};
const emptyForm = {
  dispatch_id: "",
  date: new Date().toISOString().slice(0, 10),
  pieces_received: "",
  pieces_defected: "0",
  challan_no: "",
  lot_no: "",
  article_barcode: "",
  expected_pieces: "",
  avg_fabric_per_piece: "",
  fabric_still_lying_kg: "",
  job_work_rate: "",
  notes: "",
};

function DispatchSelector({ value, options, onSelect }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selectedOption = options.find((option) => option.id === value) || null;
  const filteredOptions = options.filter((option) => {
    const term = query.trim().toLowerCase();
    if (!term) return true;
    return String(option.dispatch_no || "").toLowerCase().includes(term);
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="h-10 w-full justify-between rounded-lg border-slate-200 px-3 text-left text-sm font-normal">
          <span className="truncate">{selectedOption ? selectedOption.dispatch_no : "Select dispatch no."}</span>
          <ChevronDown className="ml-2 h-4 w-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[360px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search dispatch no." value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>No dispatch numbers found.</CommandEmpty>
            <CommandGroup>
              {filteredOptions.map((option) => (
                <CommandItem
                  key={option.id}
                  value={option.dispatch_no}
                  onSelect={() => {
                    onSelect(option);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <span className="font-medium text-slate-800">{option.dispatch_no}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default function Returns() {
  const location = useLocation();
  const [items, setItems] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [dispatches, setDispatches] = useState([]);
  const [open, setOpen] = useState(false);
  const [viewingRecord, setViewingRecord] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);
  const [formTouched, setFormTouched] = useState(false);
  const [search, setSearch] = useState("");
  const [vendorFilter, setVendorFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selectedPrintIds, setSelectedPrintIds] = useState([]);

  const getDispatchMetadata = (dispatch) => {
    if (!dispatch) {
      return {
        dispatchNo: "",
        vendorName: "",
        fabricName: "",
        brandName: "",
        productTypeName: "",
        quantity: 0,
        unit: "",
        rolls: 0,
        avgFabricPerPiece: 0,
        expectedPieces: 0,
      };
    }

    const parsed = parseDispatchNote(dispatch.notes || "{}") || {};
    const lines = Array.isArray(parsed.lines) ? parsed.lines : [];
    const firstLine = lines[0] || {};
    const quantity = Number(dispatch.quantity ?? firstLine.quantity ?? 0);
    const rolls = Number(dispatch.rolls ?? firstLine.rolls ?? 0);

    return {
      dispatchNo: dispatch.dispatch_no || parsed.dispatchNo || "",
      vendorName: dispatch.vendor_name || dispatch.vendorName || "",
      fabricName: dispatch.fabric_name || firstLine.fabricName || "",
      brandName: dispatch.brand_name || firstLine.brandName || "",
      productTypeName: dispatch.product_type_name || firstLine.productType || "",
      quantity,
      unit: dispatch.unit || firstLine.unit || "kg",
      rolls,
      avgFabricPerPiece: 0,
      expectedPieces: Number(dispatch.expected_pieces ?? parsed.expectedPieces ?? parsed.expected_pieces ?? 0),
    };
  };

  const getDispatchAvgPerPiece = () => 0;

  const getPiecesLeftForRow = (row) => {
    const expectedPieces = Number(row.expected_pieces || 0);
    const receivedPieces = Number(row.pieces_received || 0);
    if (expectedPieces > 0) {
      return Math.max(expectedPieces - receivedPieces, 0);
    }
    return 0;
  };

  const load = async () => {
    setLoading(true);
    try {
      const [returnsResponse, vendorsResponse, dispatchesResponse] = await Promise.all([
        api.get("/production-returns"),
        api.get("/vendors", { params: { include_archived: true } }),
        api.get("/production-returns/dispatches"),
      ]);
      setItems(returnsResponse.data || []);
      setVendors(vendorsResponse.data || []);
      setDispatches(dispatchesResponse.data || []);
      setPage(1);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Unable to load returns");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const handleRefresh = () => load();
    window.addEventListener("fabric-data-updated", handleRefresh);
    return () => window.removeEventListener("fabric-data-updated", handleRefresh);
  }, []);

  useEffect(() => {
    setPage(1);
  }, [search, vendorFilter]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const searchText = params.get("search") || "";
    const dispatchNo = params.get("dispatch") || "";
    const challanNo = params.get("challan") || "";
    const vendorId = params.get("vendor") || "all";
    const combined = [searchText, dispatchNo, challanNo].filter(Boolean).join(" ").trim();
    if (combined) setSearch(combined);
    if (vendorId) setVendorFilter(vendorId);
  }, [location.search]);

  const vendorMap = useMemo(() => Object.fromEntries(vendors.map((vendor) => [vendor.id, vendor.name])), [vendors]);
  const dispatchMap = useMemo(() => Object.fromEntries(dispatches.map((dispatch) => [dispatch.id, dispatch])), [dispatches]);
  const visibleDispatchOptions = useMemo(() => {

  return dispatches.filter((dispatch) => {

    const piecesLeft = Number(dispatch.pieces_left ?? 0);
    return Number.isFinite(piecesLeft) && piecesLeft > 0;
  });
}, [dispatches]);

  const selectedDispatch = form.dispatch_id ? dispatchMap[form.dispatch_id] : null;
  const selectedDispatchMeta = useMemo(() => getDispatchMetadata(selectedDispatch), [selectedDispatch]);
  const selectedVendorName = selectedDispatchMeta.vendorName || (selectedDispatch?.vendor_id ? vendorMap[selectedDispatch.vendor_id] : "") || "";
  const expectedPieces = useMemo(() => {
    const manualValue = Number(form.expected_pieces || 0);
    if (Number.isFinite(manualValue) && manualValue > 0) {
      return manualValue;
    }
    const dispatchExpectedPieces = Number(
      selectedDispatch?.expected_pieces ??
      selectedDispatchMeta.expectedPieces ??
      0
    );
    if (Number.isFinite(dispatchExpectedPieces) && dispatchExpectedPieces > 0) {
      return dispatchExpectedPieces;
    }
    const avgFabricPerPieceValue = Number(form.avg_fabric_per_piece || 0);
    if (Number.isFinite(avgFabricPerPieceValue) && avgFabricPerPieceValue > 0 && Number(selectedDispatch?.kg_dispatched || 0) > 0) {
      return Number((Number(selectedDispatch?.kg_dispatched || 0) / avgFabricPerPieceValue).toFixed(3));
    }
    return 0;
  }, [form.expected_pieces, form.avg_fabric_per_piece, selectedDispatch, selectedDispatchMeta]);

  const syncExpectedAndAvgFabric = (nextExpectedPieces, nextAvgFabricPerPiece) => {
    const safeExpected = Number(nextExpectedPieces || 0);
    const safeAvgFabric = Number(nextAvgFabricPerPiece || 0);
    const dispatchKg = Number(selectedDispatch?.kg_dispatched || 0);

    if (Number.isFinite(safeExpected) && safeExpected > 0) {
      const computedAvg = dispatchKg > 0 ? Number((dispatchKg / safeExpected).toFixed(3)) : 0;
      return {
        expected_pieces: String(safeExpected),
        avg_fabric_per_piece: computedAvg > 0 ? String(computedAvg) : "",
      };
    }

    if (Number.isFinite(safeAvgFabric) && safeAvgFabric > 0 && dispatchKg > 0) {
      const computedExpected = Number((dispatchKg / safeAvgFabric).toFixed(3));
      return {
        expected_pieces: computedExpected > 0 ? String(computedExpected) : "",
        avg_fabric_per_piece: String(safeAvgFabric),
      };
    }

    return {
      expected_pieces: String(safeExpected || ""),
      avg_fabric_per_piece: String(safeAvgFabric || ""),
    };
  };
  const alreadyReceived = Number(selectedDispatch?.pieces_received_total || 0);

  const availableForReceipt = useMemo(() => {
    if (!selectedDispatch) return 0;
    const baseAvailable = Math.max(expectedPieces - alreadyReceived, 0);
    if (editing && (editing.dispatch_id || editing.order_id) === selectedDispatch.id) {
      return baseAvailable + Number(editing.pieces_received || 0);
    }
    return baseAvailable;
  }, [selectedDispatch, editing, expectedPieces, alreadyReceived]);

  const piecesLeftPreview = useMemo(() => {
    const currentEntry = Number(form.pieces_received || 0);
    const effectiveExpectedPieces = Number(form.expected_pieces || expectedPieces || 0);
    if (!selectedDispatch) return 0;
    return Math.max(effectiveExpectedPieces - alreadyReceived - currentEntry, 0);
  }, [selectedDispatch, form.pieces_received, form.expected_pieces, expectedPieces, alreadyReceived]);

  const jobWorkAmountPreview = useMemo(() => {
    const rate = Number(form.job_work_rate || 0);
    const pieces = Number(form.pieces_received || 0);
    return Number.isFinite(rate) && Number.isFinite(pieces) ? roundCurrency(rate * pieces) : 0;
  }, [form.job_work_rate, form.pieces_received]);

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm);
    setFormTouched(false);
    setOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setForm({
      dispatch_id: row.dispatch_id || row.order_id || "",
      date: row.date ? row.date.slice(0, 10) : new Date().toISOString().slice(0, 10),
      pieces_received: String(row.pieces_received || ""),
      pieces_defected: String(row.pieces_defected || 0),
      challan_no: row.challan_no || "",
      lot_no: row.lot_no || "",
      article_barcode: row.article_barcode || "",
      expected_pieces: row.expected_pieces != null ? String(row.expected_pieces) : "",
      avg_fabric_per_piece: row.avg_fabric_per_piece != null ? String(row.avg_fabric_per_piece) : "",
      fabric_still_lying_kg: row.fabric_still_lying_kg != null ? String(row.fabric_still_lying_kg) : "",
      job_work_rate: row.job_work_rate || row.job_work_rate_per_piece || "",
      notes: row.notes || "",
    });
    setFormTouched(false);
    setOpen(true);
  };

  const handleDispatchSelect = (dispatch) => {
    const nextExpectedPieces = Number(dispatch.expected_pieces ?? 0);
    setForm((prev) => ({
      ...prev,
      dispatch_id: dispatch.id,
      expected_pieces: formTouched ? prev.expected_pieces : (nextExpectedPieces > 0 ? String(nextExpectedPieces) : ""),
      avg_fabric_per_piece: formTouched ? prev.avg_fabric_per_piece : "",
      fabric_still_lying_kg: formTouched ? prev.fabric_still_lying_kg : "",
    }));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.dispatch_id) {
      return toast.error("Select a dispatch number to continue.");
    }

    const piecesReceived = form.pieces_received === "" ? 0 : Number(form.pieces_received || 0);
    const piecesDefected = Number(form.pieces_defected || 0);

    if (form.pieces_received !== "" && (!Number.isFinite(piecesReceived) || piecesReceived < 0)) {
      return toast.error("Pieces received cannot be negative.");
    }

    if (!Number.isFinite(piecesDefected) || piecesDefected < 0) {
      return toast.error("Defected pieces cannot be negative.");
    }

    const dispatch = dispatchMap[form.dispatch_id];
    if (!dispatch) return toast.error("Selected dispatch was not found.");

    const avgFabricPerPieceValue = form.avg_fabric_per_piece === "" ? null : Number(form.avg_fabric_per_piece);
    if (avgFabricPerPieceValue !== null && (!Number.isFinite(avgFabricPerPieceValue) || avgFabricPerPieceValue < 0)) {
      return toast.error("Avg fabric per piece cannot be negative.");
    }

    const dispatchKg = Number(selectedDispatch?.kg_dispatched || 0);
    const expectedInput = Number(form.expected_pieces || 0);
    let expectedPiecesValue = 0;

    if (expectedInput > 0) {
      expectedPiecesValue = expectedInput;
    } else if (avgFabricPerPieceValue && avgFabricPerPieceValue > 0 && dispatchKg > 0) {
      expectedPiecesValue = dispatchKg / avgFabricPerPieceValue;
    }

    if (!Number.isFinite(expectedPiecesValue) || expectedPiecesValue <= 0) {
      return toast.error("Expected pieces must be greater than zero.");
    }

    const fabricStillLyingValue = form.fabric_still_lying_kg === "" ? null : Number(form.fabric_still_lying_kg);
    if (fabricStillLyingValue !== null && (!Number.isFinite(fabricStillLyingValue) || fabricStillLyingValue < 0)) {
      return toast.error("Fabric still lying cannot be negative.");
    }

    const pendingBalance = Math.max(expectedPiecesValue - alreadyReceived, 0);
    if (piecesReceived > pendingBalance + (editing && (editing.dispatch_id || editing.order_id) === dispatch.id ? Number(editing.pieces_received || 0) : 0) + 1e-9) {
      return toast.error(`Pieces received exceeds pending balance (${fmtNum(pendingBalance)})`);
    }

    const jobWorkRate = Number(form.job_work_rate || 0);
    if (!Number.isFinite(jobWorkRate) || jobWorkRate < 0) {
      return toast.error("Job work rate cannot be negative.");
    }

    const computedFabricConsumed = fabricStillLyingValue == null ? 0 : Math.max(dispatchKg - fabricStillLyingValue, 0);

    const payload = {
      dispatch_id: form.dispatch_id,
      product_type_id: dispatch.product_type_id || "dispatch-linked",
      date: form.date || undefined,
      pieces_received: piecesReceived > 0 ? Math.round(piecesReceived) : 0,
      fabric_consumed_kg: computedFabricConsumed,
      pieces_defected: Math.round(piecesDefected),
      challan_no: form.challan_no.trim(),
      lot_no: form.lot_no.trim(),
      article_barcode: form.article_barcode.trim(),
      expected_pieces: expectedPiecesValue,
      avg_fabric_per_piece: avgFabricPerPieceValue,
      fabric_still_lying_kg: fabricStillLyingValue,
      job_work_rate: jobWorkRate,
      notes: form.notes.trim(),
    };

    try {
      if (editing) {
        await api.patch(`/production-returns/${editing.id}`, payload);
        toast.success("Receipt updated");
      } else {
        await api.post("/production-returns", payload);
        toast.success("Receipt recorded");
      }
      setForm(emptyForm);
      setEditing(null);
      setFormTouched(false);
      setOpen(false);
      await load();
      notifyFabricDataChanged();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to save receipt");
    }
  };

  const deleteReceipt = async (row) => {
    const proceed = window.confirm("Delete this receipt entry?");
    if (!proceed) return;
    try {
      await api.delete(`/production-returns/${row.id}`);
      toast.success("Receipt deleted");
      await load();
      notifyFabricDataChanged();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Unable to delete receipt");
    }
  };

  const exportCsv = () => {
    const rows = filteredItems.map((item) => ({
      date: item.date ? fmtDate(item.date) : "",
      dispatch_no: item.dispatch_no || "",
      vendor: item.vendor_name || "",
      challan_no: item.challan_no || "",
      lot_no: item.lot_no || "",
      article_barcode: item.article_barcode || "",
      pieces_received: item.pieces_received || 0,
      fabric_consumed_kg: item.fabric_consumed_kg || 0,
      pieces_left: getPiecesLeftForRow(item),
      pieces_defected: item.pieces_defected || 0,
      notes: item.notes || "",
    }));
    const headers = ["Date", "Dispatch S.No.", "Vendor", "Challan No.", "Lot No.", "Article / Barcode", "Pieces Received", "Fabric Consumed", "Pieces Left", "Pieces Defected", "Notes"];
    const csv = [headers.join(",")]
      .concat(
        rows.map((row) =>
          headers
            .map((header) => `"${String(row[header.toLowerCase().replace(/[^a-z0-9]+/g, "_")] ?? "").replace(/"/g, '""')}"`)
            .join(",")
        )
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `returns_quality_check_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter((item) => {
      const vendorId = item.vendor_id || "";
      const matchesVendor = vendorFilter === "all" || vendorId === vendorFilter;
      const searchBlob = [item.dispatch_no, item.vendor_name, item.challan_no, item.lot_no, item.article_barcode, item.notes]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const matchesSearch = !term || searchBlob.includes(term);
      return matchesVendor && matchesSearch;
    });
  }, [items, search, vendorFilter]);

  const sortedItems = useMemo(() => [...filteredItems].sort((a, b) => (b.date || "").localeCompare(a.date || "")), [filteredItems]);
  const totalPages = Math.max(1, Math.ceil(sortedItems.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedItems = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return sortedItems.slice(start, start + PAGE_SIZE);
  }, [sortedItems, safePage]);

  const shortSummary = (value) => {
    const text = String(value || "").trim();
    if (!text) return "—";
    return text.length > 70 ? `${text.slice(0, 67)}…` : text;
  };

  return (
    <div data-testid="returns-page" className="min-h-screen bg-slate-50 px-4 py-4 md:px-6">
      <div className="mx-auto max-w-7xl space-y-4">
        <PageHeader
          title="Returns & Quality Check"
          subtitle="Register receipts against fabric dispatches, track pending pieces, and keep production quality data in sync"
          eyebrow="Operations"
          actions={
            <div className="flex flex-wrap items-center gap-3">
              <Dialog open={open} onOpenChange={(value) => {
                setOpen(value);
                if (!value) {
                  setEditing(null);
                  setForm(emptyForm);
                  setFormTouched(false);
                }
              }}>
                <DialogTrigger asChild>
                  <PrimaryButton data-testid="add-return-btn" onClick={openNew}>
                    <Plus className="mr-2 h-4 w-4" /> Log Receipt
                  </PrimaryButton>
                </DialogTrigger>
                <DialogContent className="max-w-3xl rounded-[20px] border border-slate-200 bg-white p-0 shadow-2xl">
                  <div className="border-b border-slate-200 bg-slate-50 px-6 py-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500">Receipt Entry</div>
                    <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">{editing ? "Edit Receipt" : "Log Receipt"}</h2>
                  </div>
                  <form onSubmit={submit} className="space-y-4 px-6 py-5">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <Label>Dispatch S.No.</Label>
                        <div className="mt-1">
                          <DispatchSelector value={form.dispatch_id} options={visibleDispatchOptions} onSelect={handleDispatchSelect} />
                        </div>
                      </div>
                      <div>
                        <Label>Vendor</Label>
                        <Input value={selectedVendorName || "—"} readOnly className="mt-1 h-10 rounded-lg border-slate-200 bg-slate-50" />
                      </div>
                    </div>

                    <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-4">
                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                        <div>
                          <Label>Fabric</Label>
                          <Input value={selectedDispatchMeta.fabricName || "—"} readOnly className="mt-1 h-10 rounded-lg border-slate-200 bg-white" />
                        </div>
                        <div>
                          <Label>Brand</Label>
                          <Input value={selectedDispatchMeta.brandName || "—"} readOnly className="mt-1 h-10 rounded-lg border-slate-200 bg-white" />
                        </div>
                        <div>
                          <Label>Product Type</Label>
                          <Input value={selectedDispatchMeta.productTypeName || "—"} readOnly className="mt-1 h-10 rounded-lg border-slate-200 bg-white" />
                        </div>
                        <div>
                          <Label>Quantity / Unit</Label>
                          <Input value={selectedDispatch ? `${fmtNum(selectedDispatchMeta.quantity)} ${selectedDispatchMeta.unit || ""}`.trim() : "—"} readOnly className="mt-1 h-10 rounded-lg border-slate-200 bg-white" />
                        </div>
                        <div>
                          <Label>Rolls</Label>
                          <Input value={selectedDispatchMeta.rolls ? fmtNum(selectedDispatchMeta.rolls) : "—"} readOnly className="mt-1 h-10 rounded-lg border-slate-200 bg-white" />
                        </div>
                        <div>
                          <Label>Fabric Still Lying</Label>
                          <Input
                            type="number"
                            value={form.fabric_still_lying_kg}
                            onChange={(e) => setForm((prev) => ({ ...prev, fabric_still_lying_kg: e.target.value }))}
                            className="mt-1 h-10 rounded-lg border-slate-200 bg-white"
                            placeholder="Manual value"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <Label>Receipt Date</Label>
                        <Input type="date" value={form.date} onChange={(e) => setForm((prev) => ({ ...prev, date: e.target.value }))} className="mt-1 h-10 rounded-lg border-slate-200" />
                      </div>
                      <div>
                        <Label>Expected Pieces</Label>
                        <Input
                          type="number"
                          value={form.expected_pieces}
                          onChange={(e) => {
                            setFormTouched(true);
                            const nextValue = e.target.value;
                            const nextSync = syncExpectedAndAvgFabric(nextValue, form.avg_fabric_per_piece);
                            setForm((prev) => ({ ...prev, expected_pieces: nextSync.expected_pieces, avg_fabric_per_piece: nextSync.avg_fabric_per_piece }));
                          }}
                          className="mt-1 h-10 rounded-lg border-slate-200 bg-white"
                          placeholder="Manual expected pieces"
                        />
                        <div className="mt-1 text-xs text-slate-500">
                          Enter a manual value, or let it auto-calculate from Avg Fabric / Piece when that field is set.
                        </div>
                      </div>
                    </div>

                    <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-4">
                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                        <div>
                          <Label>Challan No.</Label>
                          <Input value={form.challan_no} onChange={(e) => setForm((prev) => ({ ...prev, challan_no: e.target.value }))} className="mt-1 h-10 rounded-lg border-slate-200" placeholder="CH-101" />
                        </div>
                        <div>
                          <Label>Lot No.</Label>
                          <Input value={form.lot_no} onChange={(e) => setForm((prev) => ({ ...prev, lot_no: e.target.value }))} className="mt-1 h-10 rounded-lg border-slate-200" placeholder="LOT-01" />
                        </div>
                        <div>
                          <Label>Article / Barcode</Label>
                          <Input value={form.article_barcode} onChange={(e) => setForm((prev) => ({ ...prev, article_barcode: e.target.value }))} className="mt-1 h-10 rounded-lg border-slate-200" placeholder="SKU-001" />
                        </div>
                        <div>
                          <Label>Pieces Defected</Label>
                          <Input type="number" value={form.pieces_defected} onChange={(e) => setForm((prev) => ({ ...prev, pieces_defected: e.target.value }))} className="mt-1 h-10 rounded-lg border-slate-200" placeholder="0" />
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-3">
                      <div>
                        <Label>Pieces Received</Label>
                        <Input type="number" value={form.pieces_received} onChange={(e) => setForm((prev) => ({ ...prev, pieces_received: e.target.value }))} className="mt-1 h-10 rounded-lg border-slate-200" placeholder="0" />
                      </div>
                      <div>
                        <Label>Fabric Consumed</Label>
                        <Input
                          value={fmtNum(form.fabric_still_lying_kg === "" ? 0 : Math.max(Number(selectedDispatch?.kg_dispatched || 0) - Number(form.fabric_still_lying_kg || 0), 0))}
                          readOnly
                          className="mt-1 h-10 rounded-lg border-slate-200 bg-slate-50"
                        />
                      </div>
                      <div>
                        <Label>Pieces Left</Label>
                        <Input value={fmtNum(piecesLeftPreview)} readOnly className="mt-1 h-10 rounded-lg border-slate-200 bg-slate-50" />
                      </div>
                      <div>
                        <Label>Avg Fabric / Piece</Label>
                        <Input
                          type="number"
                          value={form.avg_fabric_per_piece}
                          onChange={(e) => {
                            setFormTouched(true);
                            const nextValue = e.target.value;
                            const nextSync = syncExpectedAndAvgFabric(form.expected_pieces, nextValue);
                            setForm((prev) => ({ ...prev, expected_pieces: nextSync.expected_pieces, avg_fabric_per_piece: nextSync.avg_fabric_per_piece }));
                          }}
                          className="mt-1 h-10 rounded-lg border-slate-200 bg-white"
                          placeholder="0"
                        />
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <Label>Job Work Rate / Piece</Label>
                        <Input type="number" value={form.job_work_rate} onChange={(e) => setForm((prev) => ({ ...prev, job_work_rate: e.target.value }))} className="mt-1 h-10 rounded-lg border-slate-200" placeholder="0" />
                      </div>
                      <div>
                        <Label>Job Work Amount</Label>
                        <Input value={fmtNum(jobWorkAmountPreview)} readOnly className="mt-1 h-10 rounded-lg border-slate-200 bg-slate-50" />
                      </div>
                    </div>

                    <div>
                      <Label>Notes</Label>
                      <Textarea value={form.notes} onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))} className="mt-1 min-h-[96px] rounded-lg border-slate-200" placeholder="Optional quality remarks" />
                    </div>

                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                      {expectedPieces > 0
                        ? <>Pending balance for this dispatch is <strong>{fmtNum(Math.max(expectedPieces - alreadyReceived, 0))}</strong> pieces. Entries above this limit will be rejected.</>
                        : "Expected Pieces not set."}
                    </div>

                    <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-4">
                      <SecondaryButton type="button" onClick={() => { setOpen(false); setEditing(null); setForm(emptyForm); setFormTouched(false); }}>Cancel</SecondaryButton>
                      <PrimaryButton type="submit">{editing ? "Save Changes" : "Save Receipt"}</PrimaryButton>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          }
        />

        <PageContainer>
          <div className="mb-4 grid gap-3 md:grid-cols-5">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500">Total Receipts</div>
              <div className="mt-2 text-xl font-semibold text-slate-900">{items.length}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500">Total Pieces Received</div>
              <div className="mt-2 text-xl font-semibold text-slate-900">{fmtNum(items.reduce((sum, item) => sum + Number(item.pieces_received || 0), 0))}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500">Total Pieces Pending</div>
              <div className="mt-2 text-xl font-semibold text-slate-900">{fmtNum(items.reduce((sum, item) => {
                const expectedPieces = Number(item.expected_pieces || 0);
                const receivedPieces = Number(item.pieces_received || 0);
                return sum + (expectedPieces > 0 ? Math.max(expectedPieces - receivedPieces, 0) : 0);
              }, 0))}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500">Fabric Still Lying</div>
              <div className="mt-2 text-xl font-semibold text-slate-900">{fmtNum(dispatches.reduce((sum, dispatch) => {
                const dispatchId = dispatch.id;
                const relatedRows = items.filter((item) => (item.dispatch_id || item.order_id) === dispatchId);
                const totalUsed = relatedRows.reduce((receivedSum, item) => receivedSum + Number(item.kg_used || 0), 0);
                const totalReturned = relatedRows.reduce((receivedSum, item) => receivedSum + Number(item.fabric_returned_kg || 0), 0);
                const totalWaste = relatedRows.reduce((receivedSum, item) => receivedSum + Number(item.cutting_waste_kg || 0), 0);
                return sum + getFabricStillLyingKg(dispatch, { kg_used: totalUsed, fabric_returned_kg: totalReturned, cutting_waste_kg: totalWaste });
              }, 0))}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500">Total Defective Pieces</div>
              <div className="mt-2 text-xl font-semibold text-slate-900">{fmtNum(items.reduce((sum, item) => sum + Number(item.pieces_defected || 0), 0))}</div>
            </div>
          </div>
          <SectionCard title="Returns Register" description="Review receipt activity, pending balance, and dispatch-linked quality notes in one place.">
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-1 flex-col gap-3 md:flex-row md:items-center">
                <SearchBar value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search dispatch, challan, lot, article" />
                <Select value={vendorFilter} onValueChange={setVendorFilter}>
                  <SelectTrigger className="h-10 w-full md:w-[220px]">
                    <SelectValue placeholder="Filter by vendor" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All vendors</SelectItem>
                    {vendors.map((vendor) => (
                      <SelectItem key={vendor.id} value={vendor.id}>{vendor.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <SecondaryButton type="button" onClick={exportCsv}>
                  <Download className="mr-2 h-4 w-4" /> Export
                </SecondaryButton>
                <UniversalPrintButton
                  moduleName="Returns & QC"
                  rows={sortedItems}
                  columns={[
                    { key: "challan_no", label: "Challan No" },
                    { key: "date", label: "Date" },
                    { key: "dispatch_no", label: "Dispatch No" },
                    { key: "pieces_received", label: "Pieces Received" },
                    { key: "pieces_left", label: "Pieces Left" },
                    { key: "pieces_defected", label: "Defective Pieces" },
                  ]}
                  summary={[
                    { label: "Pieces Received", value: sortedItems.reduce((sum, row) => sum + Number(row.pieces_received || 0), 0) },
                    { label: "Pieces Left", value: sortedItems.reduce((sum, row) => sum + Number(row.pieces_left || 0), 0) },
                    { label: "Defective Pieces", value: sortedItems.reduce((sum, row) => sum + Number(row.pieces_defected || 0), 0) },
                  ]}
                  reportTitle="Returns & QC Register"
                  reportPeriod="All Returns"
                  selectedRows={sortedItems.filter((row) => selectedPrintIds.includes(row.id))}
                  filteredRows={sortedItems}
                  allRows={items}
                  selectedIds={selectedPrintIds}
                  onSelectedIdsChange={setSelectedPrintIds}
                />
              </div>
            </div>

            {loading ? (
              <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-6 text-sm text-slate-600">Loading receipts…</div>
            ) : sortedItems.length === 0 ? (
              <EmptyState title="No receipts logged yet" description="Create a receipt entry against a fabric dispatch and the balance will update automatically." />
            ) : (
              <>
                <TableContainer>
                  <table className="min-w-[1200px] w-full border-separate border-spacing-0">
                    <thead className="bg-slate-50">
                      <tr>
                        {['Date','Dispatch S.No.','Vendor','Challan No.','Lot No.','Article / Barcode','Pieces Received','Fabric Consumed','Pieces Left','Fabric Still Lying','Pieces Defected','Notes','Actions'].map((heading) => (
                          <th key={heading} className="border-b border-slate-200 px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                            {heading}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pagedItems.map((row) => (
                        <tr key={row.id} className="border-b border-slate-100 bg-white">
                          <td className="px-3 py-3 text-sm text-slate-700">{fmtDate(row.date)}</td>
                          <td className="px-3 py-3 text-sm font-medium text-slate-800">{row.dispatch_no || "—"}</td>
                          <td className="px-3 py-3 text-sm text-slate-700">{row.vendor_name || vendorMap[row.vendor_id] || "—"}</td>
                          <td className="px-3 py-3 text-sm text-slate-700">{row.challan_no || "—"}</td>
                          <td className="px-3 py-3 text-sm text-slate-700">{row.lot_no || "—"}</td>
                          <td className="px-3 py-3 text-sm text-slate-700">{row.article_barcode || "—"}</td>
                          <td className="px-3 py-3 text-right text-sm font-medium text-slate-800">{fmtNum(row.pieces_received || 0)}</td>
                          <td className="px-3 py-3 text-right text-sm font-medium text-slate-800">{fmtNum(row.fabric_consumed_kg || 0)}</td>
                          <td className="px-3 py-3 text-right text-sm font-medium text-emerald-700">{fmtNum(getPiecesLeftForRow(row))}</td>
                          <td className="px-3 py-3 text-right text-sm font-medium text-slate-800">{fmtNum(row.fabric_still_lying_kg != null && row.fabric_still_lying_kg !== "" ? Number(row.fabric_still_lying_kg) : getFabricStillLyingKg(dispatchMap[row.dispatch_id || row.order_id] || {}, row))}</td>
                          <td className="px-3 py-3 text-right text-sm text-slate-700">{fmtNum(row.pieces_defected || 0)}</td>
                          <td className="max-w-[220px] px-3 py-3 text-sm text-slate-600">{shortSummary(row.notes || "")}</td>
                          <td className="px-3 py-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <Button type="button" variant="ghost" size="sm" onClick={() => setViewingRecord(row)}>
                                <Eye className="mr-1 h-4 w-4" /> View
                              </Button>
                              <Button type="button" variant="ghost" size="sm" onClick={() => openEdit(row)}>
                                <Pencil className="mr-1 h-4 w-4" /> Edit
                              </Button>
                              <Button type="button" variant="ghost" size="sm" className="text-rose-600" onClick={() => deleteReceipt(row)}>
                                <Trash2 className="mr-1 h-4 w-4" /> Delete
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableContainer>

                <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
                  <div>Showing {sortedItems.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1} to {Math.min(safePage * PAGE_SIZE, sortedItems.length)} of {sortedItems.length}</div>
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => setPage((prev) => Math.max(1, prev - 1))} disabled={safePage <= 1}>Previous</Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => setPage((prev) => Math.min(prev + 1, totalPages))} disabled={safePage >= totalPages}>Next</Button>
                  </div>
                </div>
              </>
            )}
          </SectionCard>
        </PageContainer>
      </div>

      <Dialog open={Boolean(viewingRecord)} onOpenChange={(openValue) => setViewingRecord(openValue ? viewingRecord : null)}>
        <DialogContent className="max-w-xl rounded-[20px] border-slate-200">
          {viewingRecord ? (
            <div className="space-y-4">
              <div className="border-b border-slate-200 pb-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500">Receipt Overview</div>
                <div className="mt-1 text-lg font-semibold text-slate-900">{viewingRecord.dispatch_no || "Dispatch receipt"}</div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                  <div className="text-slate-500">Vendor</div>
                  <div className="mt-1 font-medium text-slate-800">{viewingRecord.vendor_name || "—"}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                  <div className="text-slate-500">Challan</div>
                  <div className="mt-1 font-medium text-slate-800">{viewingRecord.challan_no || "—"}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                  <div className="text-slate-500">Pieces Received</div>
                  <div className="mt-1 font-medium text-slate-800">{fmtNum(viewingRecord.pieces_received || 0)}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                  <div className="text-slate-500">Fabric Consumed</div>
                  <div className="mt-1 font-medium text-slate-800">{fmtNum(viewingRecord.fabric_consumed_kg || 0)}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                  <div className="text-slate-500">Pieces Left</div>
                  <div className="mt-1 font-medium text-slate-800">{fmtNum(getPiecesLeftForRow(viewingRecord))}</div>
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">{viewingRecord.notes || "No quality notes recorded for this receipt."}</div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
