import { useRef, useState, useEffect } from "react";
import { Upload, Loader2, CheckCircle2, FileImage, Settings2, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type Extracted = { date: string; merchant: string; currency: string; total: number };

const SHEET_KEY = "doona_receipt_sheet_id";
const TAB_KEY = "doona_receipt_sheet_tab";

function extractSheetId(input: string): string {
  const m = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : input.trim();
}

export const ReceiptScanner = () => {
  const [spreadsheetId, setSpreadsheetId] = useState("");
  const [sheetName, setSheetName] = useState("Sheet1");
  const [showSettings, setShowSettings] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Extracted | null>(null);
  const [history, setHistory] = useState<Extracted[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const id = localStorage.getItem(SHEET_KEY) || "";
    const tab = localStorage.getItem(TAB_KEY) || "Sheet1";
    setSpreadsheetId(id);
    setSheetName(tab);
    if (!id) setShowSettings(true);
  }, []);

  const saveSettings = () => {
    const id = extractSheetId(spreadsheetId);
    if (!id) return toast.error("Please enter a Google Sheet ID or URL");
    localStorage.setItem(SHEET_KEY, id);
    localStorage.setItem(TAB_KEY, sheetName || "Sheet1");
    setSpreadsheetId(id);
    setShowSettings(false);
    toast.success("Sheet settings saved");
  };

  const handleFile = (f: File | null) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) return toast.error("Please select an image");
    setFile(f);
    setResult(null);
    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result as string);
    reader.readAsDataURL(f);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    handleFile(e.dataTransfer.files?.[0] || null);
  };

  const scan = async () => {
    if (!file) return toast.error("Upload a receipt image first");
    const id = localStorage.getItem(SHEET_KEY);
    if (!id) {
      setShowSettings(true);
      return toast.error("Configure your Google Sheet first");
    }
    setLoading(true);
    setResult(null);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => {
          const s = (r.result as string).split(",")[1];
          resolve(s);
        };
        r.onerror = reject;
        r.readAsDataURL(file);
      });

      const { data, error } = await supabase.functions.invoke("scan-receipt", {
        body: {
          imageBase64: base64,
          mimeType: file.type,
          spreadsheetId: id,
          sheetName: localStorage.getItem(TAB_KEY) || "Sheet1",
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setResult(data.extracted);
      setHistory((h) => [data.extracted, ...h].slice(0, 5));
      toast.success("Receipt added to your sheet");
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || "Failed to scan receipt");
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setFile(null);
    setPreview(null);
    setResult(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Settings */}
      <Card className="p-5 shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Settings2 className="h-4 w-4" />
            <span>
              Sheet:{" "}
              {spreadsheetId ? (
                <span className="font-mono text-foreground">
                  {spreadsheetId.slice(0, 12)}…/{sheetName}
                </span>
              ) : (
                <span className="text-destructive">Not configured</span>
              )}
            </span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setShowSettings((s) => !s)}>
            {showSettings ? "Close" : "Configure"}
          </Button>
        </div>
        {showSettings && (
          <div className="mt-4 space-y-3 border-t pt-4">
            <div>
              <Label htmlFor="sheet">Google Sheet URL or ID</Label>
              <Input
                id="sheet"
                placeholder="https://docs.google.com/spreadsheets/d/..."
                value={spreadsheetId}
                onChange={(e) => setSpreadsheetId(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="tab">Sheet tab name</Label>
              <Input id="tab" value={sheetName} onChange={(e) => setSheetName(e.target.value)} />
            </div>
            <p className="text-xs text-muted-foreground">
              Make sure the sheet is shared with edit access to the connected Google account. Columns: Date, Merchant,
              Currency, Total, Scanned At.
            </p>
            <Button onClick={saveSettings} size="sm">
              Save
            </Button>
          </div>
        )}
      </Card>

      {/* Uploader */}
      <Card className="overflow-hidden shadow-[var(--shadow-elegant)]">
        <div
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
          className="relative border-b bg-[var(--gradient-subtle)] p-8"
        >
          {preview ? (
            <div className="flex flex-col items-center gap-4">
              <img
                src={preview}
                alt="Receipt preview"
                className="max-h-80 rounded-lg border bg-white object-contain shadow-md"
              />
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={reset} disabled={loading}>
                  Change image
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex w-full flex-col items-center gap-3 rounded-xl border-2 border-dashed border-border py-12 text-center transition-colors hover:border-primary hover:bg-accent/40"
            >
              <div className="rounded-full bg-primary/10 p-4 text-primary">
                <Upload className="h-7 w-7" />
              </div>
              <div>
                <p className="font-medium">Drop a receipt here, or click to upload</p>
                <p className="text-sm text-muted-foreground">PNG, JPG, HEIC — up to 10 MB</p>
              </div>
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0] || null)}
          />
        </div>

        <div className="flex items-center justify-between gap-3 p-5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <FileImage className="h-4 w-4" />
            {file ? <span className="truncate max-w-[16rem]">{file.name}</span> : <span>No file selected</span>}
          </div>
          <Button onClick={scan} disabled={!file || loading} size="lg" className="min-w-40">
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Scanning…
              </>
            ) : (
              <>Scan & Save</>
            )}
          </Button>
        </div>
      </Card>

      {/* Result */}
      {result && (
        <Card className="border-success/30 bg-success/5 p-5">
          <div className="mb-3 flex items-center gap-2 font-medium text-success">
            <CheckCircle2 className="h-5 w-5" />
            Added to Google Sheet
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Field label="Date" value={result.date} />
            <Field label="Merchant" value={result.merchant} />
            <Field label="Currency" value={result.currency} />
            <Field label="Total" value={String(result.total)} />
          </div>
        </Card>
      )}

      {/* History */}
      {history.length > 0 && (
        <Card className="p-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium">
            <Receipt className="h-4 w-4 text-muted-foreground" />
            Recently scanned (this session)
          </div>
          <div className="divide-y">
            {history.map((r, i) => (
              <div key={i} className="grid grid-cols-4 gap-2 py-2 text-sm">
                <span className="text-muted-foreground">{r.date}</span>
                <span className="truncate font-medium">{r.merchant}</span>
                <span>{r.currency}</span>
                <span className="text-right tabular-nums">{r.total}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};

const Field = ({ label, value }: { label: string; value: string }) => (
  <div>
    <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
    <p className="mt-1 font-medium">{value || "—"}</p>
  </div>
);
