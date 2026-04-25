import { useEffect, useRef, useState } from "react";
import { CheckCircle2, FileImage, Loader2, Receipt, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

// Hardcoded — the company spreadsheet
const SPREADSHEET_ID = "1Lyr3ghfgaBLM7Sdoz6v5mRbuENxGC2zw9XjVwskJQl8";
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`;

type Extracted = {
  date: string;
  category: string;
  amount: number;
  currency: string;
  description: string;
  payment_method: string;
  city: string;
  country: string;
  raw_text: string;
};

type Options = {
  categories: string[];
  currencies: string[];
  payment_methods: string[];
};

export const ReceiptScanner = () => {
  const [options, setOptions] = useState<Options | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [stage, setStage] = useState<"upload" | "review" | "done">("upload");
  const [extracting, setExtracting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<Extracted | null>(null);
  const [history, setHistory] = useState<Extracted[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabase.functions
      .invoke("scan-receipt", { body: { mode: "options" } })
      .then(({ data }) => data && setOptions(data as Options));
  }, []);

  const handleFile = (f: File | null) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) return toast.error("Please select an image");
    if (f.size > 10 * 1024 * 1024) return toast.error("Image too large (max 10 MB)");
    setFile(f);
    const r = new FileReader();
    r.onload = () => setPreview(r.result as string);
    r.readAsDataURL(f);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    handleFile(e.dataTransfer.files?.[0] || null);
  };

  const reset = () => {
    setFile(null);
    setPreview(null);
    setForm(null);
    setStage("upload");
    if (fileRef.current) fileRef.current.value = "";
  };

  const extractFromImage = async () => {
    if (!file) return;
    setExtracting(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve((r.result as string).split(",")[1]);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      const { data, error } = await supabase.functions.invoke("scan-receipt", {
        body: { mode: "extract", imageBase64: base64, mimeType: file.type },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setForm(data.extracted);
      setStage("review");
    } catch (e: any) {
      toast.error(e.message || "Failed to read receipt");
    } finally {
      setExtracting(false);
    }
  };

  const submit = async () => {
    if (!form || !file) return;
    setSubmitting(true);
    try {
      // 1. Upload receipt image to storage
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const filename = `${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("receipts")
        .upload(filename, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("receipts").getPublicUrl(filename);
      const drive_url = pub.publicUrl;

      // 2. Append validated row
      const { data, error } = await supabase.functions.invoke("scan-receipt", {
        body: {
          mode: "append",
          spreadsheetId: SPREADSHEET_ID,
          row: { ...form, filename, drive_url },
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setHistory((h) => [form, ...h].slice(0, 5));
      setStage("done");
      toast.success("Saved to the company spreadsheet");
    } catch (e: any) {
      toast.error(e.message || "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  };

  const update = <K extends keyof Extracted>(k: K, v: Extracted[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Step indicator */}
      <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <Step n={1} label="Upload" active={stage === "upload"} done={stage !== "upload"} />
        <span className="h-px w-8 bg-border" />
        <Step n={2} label="Review" active={stage === "review"} done={stage === "done"} />
        <span className="h-px w-8 bg-border" />
        <Step n={3} label="Saved" active={stage === "done"} done={stage === "done"} />
      </div>

      {stage === "upload" && (
        <Card className="overflow-hidden shadow-[var(--shadow-elegant)]">
          <div
            onDrop={onDrop}
            onDragOver={(e) => e.preventDefault()}
            className="border-b bg-[var(--gradient-subtle)] p-8"
          >
            {preview ? (
              <div className="flex flex-col items-center gap-4">
                <img
                  src={preview}
                  alt="Receipt preview"
                  className="max-h-80 rounded-lg border bg-white object-contain shadow-md"
                />
                <Button variant="outline" size="sm" onClick={reset} disabled={extracting}>
                  Change image
                </Button>
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
              {file ? <span className="max-w-[16rem] truncate">{file.name}</span> : <span>No file selected</span>}
            </div>
            <Button onClick={extractFromImage} disabled={!file || extracting} size="lg" className="min-w-44">
              {extracting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Reading receipt…
                </>
              ) : (
                <>Read receipt</>
              )}
            </Button>
          </div>
        </Card>
      )}

      {stage === "review" && form && options && (
        <Card className="p-6 shadow-[var(--shadow-elegant)]">
          <div className="mb-4">
            <h3 className="font-semibold">Review extracted details</h3>
            <p className="text-sm text-muted-foreground">
              Edit any field if needed. Dropdowns ensure values match the company spreadsheet exactly.
            </p>
          </div>

          {preview && (
            <img
              src={preview}
              alt="Receipt"
              className="mb-5 max-h-48 w-full rounded-md border bg-white object-contain"
            />
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date">
              <Input
                type="date"
                value={form.date}
                onChange={(e) => update("date", e.target.value)}
              />
            </Field>

            <Field label="Category">
              <Select value={form.category} onValueChange={(v) => update("category", v)}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  {options.categories.map((c) => (
                    <SelectItem key={c} value={c} dir="rtl">{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Amount">
              <Input
                type="number"
                step="0.01"
                min="0"
                value={form.amount}
                onChange={(e) => update("amount", Number(e.target.value))}
              />
            </Field>

            <Field label="Currency">
              <Select value={form.currency} onValueChange={(v) => update("currency", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {options.currencies.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Payment method">
              <Select value={form.payment_method} onValueChange={(v) => update("payment_method", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {options.payment_methods.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="City">
              <Input value={form.city} onChange={(e) => update("city", e.target.value)} />
            </Field>

            <Field label="Country">
              <Input value={form.country} onChange={(e) => update("country", e.target.value)} />
            </Field>

            <div className="sm:col-span-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Description
              </Label>
              <Input
                value={form.description}
                onChange={(e) => update("description", e.target.value)}
                maxLength={120}
              />
            </div>

            <div className="sm:col-span-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Raw text (read-only)
              </Label>
              <Textarea value={form.raw_text} readOnly rows={3} className="mt-1 bg-muted/40 text-xs" />
            </div>
          </div>

          <div className="mt-6 flex justify-between gap-3">
            <Button variant="outline" onClick={reset} disabled={submitting}>
              Start over
            </Button>
            <Button onClick={submit} disabled={submitting} size="lg" className="min-w-44">
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…
                </>
              ) : (
                <>Submit to spreadsheet</>
              )}
            </Button>
          </div>
        </Card>
      )}

      {stage === "done" && form && (
        <Card className="border-success/30 bg-success/5 p-6 text-center">
          <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-success" />
          <h3 className="text-lg font-semibold">Receipt submitted</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Added a new row to the <span className="font-mono">RAW</span> sheet with the receipt image attached.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <Button onClick={reset}>Scan another</Button>
            <Button variant="outline" asChild>
              <a href={SHEET_URL} target="_blank" rel="noreferrer">Open spreadsheet</a>
            </Button>
          </div>
        </Card>
      )}

      {history.length > 0 && stage !== "review" && (
        <Card className="p-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium">
            <Receipt className="h-4 w-4 text-muted-foreground" />
            Recently submitted (this session)
          </div>
          <div className="divide-y">
            {history.map((r, i) => (
              <div key={i} className="grid grid-cols-[6rem_1fr_5rem_5rem] gap-2 py-2 text-sm">
                <span className="text-muted-foreground">{r.date}</span>
                <span className="truncate" dir="rtl">{r.category}</span>
                <span>{r.currency}</span>
                <span className="text-right tabular-nums">{r.amount}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
    <div className="mt-1">{children}</div>
  </div>
);

const Step = ({ n, label, active, done }: { n: number; label: string; active: boolean; done: boolean }) => (
  <div className={`flex items-center gap-2 ${active || done ? "text-foreground" : ""}`}>
    <span
      className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-medium ${
        done ? "bg-success text-success-foreground" : active ? "bg-primary text-primary-foreground" : "bg-muted"
      }`}
    >
      {done ? "✓" : n}
    </span>
    <span className="font-medium">{label}</span>
  </div>
);
