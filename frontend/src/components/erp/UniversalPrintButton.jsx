import { useMemo, useState } from "react";
import { ChevronDown, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { buildPrintableRows, buildReportHtml, openPrintWindow } from "@/lib/printEngine";

function formatLabel(value) {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

export default function UniversalPrintButton({
  moduleName,
  rows = [],
  columns = [],
  summary = [],
  reportTitle,
  reportPeriod,
  selectedRows = [],
  currentPageRows = [],
  filteredRows = [],
  printedBy = "System",
  bodyHtml,
  company,
  disabled = false,
  buttonLabel = "Print",
  selectedIds,
  onSelectedIdsChange,
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("filtered");
  const [includeSummary, setIncludeSummary] = useState(true);
  const [includeHeader, setIncludeHeader] = useState(true);
  const [includeFooter, setIncludeFooter] = useState(true);
  const [paperSize, setPaperSize] = useState("A4");
  const [orientation, setOrientation] = useState("portrait");
  const [margin, setMargin] = useState("normal");
  const [internalSelectedIds, setInternalSelectedIds] = useState([]);
  const activeSelectedIds = selectedIds ?? internalSelectedIds;

  const printRows = useMemo(() => {
    const preparedRows = buildPrintableRows({
      mode,
      selectedRows: selectedRows.length ? selectedRows : rows.filter((row, index) => activeSelectedIds.includes(row.id || row.uuid || row.reference_id || row.reference_no || row.dispatch_no || row.order_number || index)),
      currentPageRows,
      filteredRows,
      allRows: rows,
    });
    return preparedRows;
  }, [mode, rows, selectedRows, activeSelectedIds, currentPageRows, filteredRows]);

  const allVisible = useMemo(() => rows.length > 0, [rows.length]);
  const selectedCount = selectedRows.length || activeSelectedIds.length;

  const handlePrint = (action = "print") => {
    const html = buildReportHtml({
      moduleName,
      rows: printRows,
      columns,
      summary,
      reportTitle,
      reportPeriod,
      printedBy,
      bodyHtml,
      company,
      options: {
        showCompanyHeader: includeHeader,
        showSummary: includeSummary,
        showFooter: includeFooter,
        paperSize,
        orientation,
        margin,
      },
    });
    openPrintWindow(html, action);
    setOpen(false);
  };

  const updateSelection = (next) => {
    if (onSelectedIdsChange) {
      onSelectedIdsChange(next);
      return;
    }
    setInternalSelectedIds(next);
  };

  const toggleSelectAll = () => {
    if (activeSelectedIds.length === rows.length) {
      updateSelection([]);
      return;
    }
    updateSelection(rows.map((row, index) => row.id || row.uuid || row.reference_id || row.reference_no || row.dispatch_no || row.order_number || index));
  };

  const toggleRow = (row, index) => {
    const key = row.id || row.uuid || row.reference_id || row.reference_no || row.dispatch_no || row.order_number || index;
    const next = activeSelectedIds.includes(key) ? activeSelectedIds.filter((item) => item !== key) : [...activeSelectedIds, key];
    updateSelection(next);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" className="gap-2" disabled={disabled}>
            <Printer className="h-4 w-4" />
            {buttonLabel} ▼
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => { setMode("selected"); setOpen(true); }}>
            Print Selected
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => { setMode("page"); setOpen(true); }}>
            Print Current Page
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => { setMode("filtered"); setOpen(true); }}>
            Print Filtered Data
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => { setMode("all"); setOpen(true); }}>
            Print All Records
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">Print Report</DialogTitle>
            <DialogDescription className="sr-only">Choose the print scope, configure the export options, and review the selected rows.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-4">
              <div>
                <Label className="mb-2 block">Print Scope</Label>
                <Select value={mode} onValueChange={setMode}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="selected">Print Selected</SelectItem>
                    <SelectItem value="page">Print Current Page</SelectItem>
                    <SelectItem value="filtered">Print Filtered Data</SelectItem>
                    <SelectItem value="all">Print All Records</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="rounded-lg border border-slate-200 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <Label className="text-sm">Selection</Label>
                  <Button type="button" variant="ghost" size="sm" onClick={toggleSelectAll}>Select All</Button>
                </div>
                <div className="max-h-56 space-y-2 overflow-auto">
                  {rows.map((row, index) => {
                    const key = row.id || row.uuid || row.reference_id || row.reference_no || row.dispatch_no || row.order_number || index;
                    const checked = activeSelectedIds.includes(key) || selectedRows.some((selected) => selected.id === row.id || selected.uuid === row.uuid || selected.reference_id === row.reference_id || selected.reference_no === row.reference_no || selected.dispatch_no === row.dispatch_no || selected.order_number === row.order_number || selected === row);
                    return (
                      <label key={key} className="flex items-center gap-2 rounded-md border border-slate-200 px-2 py-2 text-sm">
                        <Checkbox checked={checked} onCheckedChange={() => toggleRow(row, index)} />
                        <span>{formatLabel(row[columns[0]?.key] || row.name || row.reference_no || row.dispatch_no || row.order_number || `Row ${index + 1}`)}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <Label className="mb-2 block">Paper Size</Label>
                <Select value={paperSize} onValueChange={setPaperSize}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="A4">A4 Portrait</SelectItem>
                    <SelectItem value="Letter">Letter</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-2 block">Orientation</Label>
                <Select value={orientation} onValueChange={setOrientation}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="portrait">Portrait</SelectItem>
                    <SelectItem value="landscape">Landscape</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-2 block">Margins</Label>
                <Select value={margin} onValueChange={setMargin}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="narrow">Narrow</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="wide">Wide</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-3 rounded-lg border border-slate-200 p-3">
                <label className="flex items-center justify-between text-sm"><span>Show Company Header</span><Switch checked={includeHeader} onCheckedChange={setIncludeHeader} /></label>
                <label className="flex items-center justify-between text-sm"><span>Show Summary</span><Switch checked={includeSummary} onCheckedChange={setIncludeSummary} /></label>
                <label className="flex items-center justify-between text-sm"><span>Show Footer</span><Switch checked={includeFooter} onCheckedChange={setIncludeFooter} /></label>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
            <div className="font-medium text-slate-700">Print target</div>
            <div className="mt-1">{mode === "selected" ? `${selectedCount} selected rows` : mode === "page" ? `Current page (${printRows.length} rows)` : mode === "filtered" ? `Filtered data (${printRows.length} rows)` : `All records (${printRows.length} rows)`}</div>
          </div>

          <DialogFooter className="flex justify-between gap-2">
            <div className="text-sm text-slate-500">{allVisible ? "Visible columns and current filters are preserved in the report." : "No records available."}</div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => handlePrint("download")}>Save as PDF</Button>
              <Button type="button" onClick={() => handlePrint("print")}>Print</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
