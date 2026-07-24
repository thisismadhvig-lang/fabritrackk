import { useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Upload, FileText } from "lucide-react";

export default function CsvImportButton({ endpoint, label, columns, sampleFilename, onDone, testid }) {
  const fileRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await api.post(endpoint, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setResult(res.data);
      if (res.data.created > 0) {
        toast.success(`Imported ${res.data.created} rows`);
        onDone && onDone();
      }
      if (res.data.errors?.length) {
        toast.warning(`${res.data.errors.length} rows had errors`);
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || "Import failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const downloadSample = () => {
    const header = columns.join(",");
    const blob = new Blob([header + "\n"], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = sampleFilename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid={testid} variant="outline" className="border-slate-300">
          <Upload className="h-4 w-4 mr-2" /> CSV Import
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle className="font-heading">{label}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="text-sm text-slate-600">
            Upload a CSV file with these columns:
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-md p-3 text-xs font-mono-plex">
            {columns.join(", ")}
          </div>
          <Button data-testid={`${testid}-sample`} onClick={downloadSample} variant="outline" size="sm" className="w-full">
            <FileText className="h-4 w-4 mr-2" /> Download sample CSV
          </Button>
          <input
            data-testid={`${testid}-file`}
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFile}
            className="block w-full text-sm text-slate-600 file:mr-3 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-slate-900 file:text-white hover:file:bg-slate-800 file:cursor-pointer"
            disabled={busy}
          />
          {busy && <div className="text-xs text-slate-500">Uploading & processing…</div>}
          {result && (
            <div className="border border-slate-200 rounded-md p-3 text-sm">
              <div className="text-emerald-700 font-medium">Imported: {result.created}</div>
              {result.errors?.length > 0 && (
                <div className="mt-2">
                  <div className="text-red-600 font-medium text-xs">Errors:</div>
                  <ul className="text-xs text-red-500 mt-1 max-h-32 overflow-y-auto space-y-0.5">
                    {result.errors.map((e) => <li key={e}>• {e}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
