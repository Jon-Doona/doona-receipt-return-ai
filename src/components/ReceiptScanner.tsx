import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ExternalLink,
  FileImage,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  gasAnalyzeReceipt,
  gasSaveExpense,
  gasGetOptions,
  gasCreateTrip,
  gasVerifySheet,
  gasUploadImageToDrive,
  gasSendEmail,
} from "@/config/api";

type Options = {
  categories: string[];
  currencies: string[];
  payment_methods: { id: string; label: string }[];
};

type Section = {
  title: string;
  header_row: number;
  first_data_row: number;
  last_data_row: number;
};

type Trip = {
  spreadsheetId: string;
  sheetId: number;
  sheetTitle: string;
  sheetUrl: string;
  sections: Section[];
  traveler_name: string;
  country: string;
  folderId?: string | null;
  folderUrl?: string | null;
};

type Itinerary = { destination: string; from: string; to: string };

type Receipt = {
  id: string;
  file: File;
  previewUrl: string;
  status: "pending" | "scanning" | "ready" | "saving" | "saved" | "error";
  error?: string;
  date?: string;
  destination?: string;
  currency?: string;
  amount?: number;
  category?: string;
  payment_method?: "company_card" | "employee";
  driveUrl?: string;
  savedRow?: number;
  warnings?: string[];
};

const STORAGE_KEY = "doona.activeTrip";
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type ReceiptScannerProps = { userEmail: string };

export const ReceiptScanner = ({ userEmail }: ReceiptScannerProps) => {
  const [options, setOptions] = useState<Options | null>(null);
  const [step, setStep] = useState<"setup" | "upload">("setup");
  const [trip, setTrip] = useState<Trip | null>(null);
  const [creating, setCreating] = useState(false);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const scanQueueRef = useRef<Promise<void>>(Promise.resolve());

  // Trip setup form
  const [traveler, setTraveler] = useState("");
  const [role, setRole] = useState("");
  const [country, setCountry] = useState("");
  const [purpose, setPurpose] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [businessDays, setBusinessDays] = useState<number | "">("");
  const [itinerary, setItinerary] = useState<Itinerary[]>([
    { destination: "", from: "", to: "" },
  ]);

  useEffect(() => {
    gasGetOptions()
      .then((data) => setOptions(data))
      .catch((err) => console.error("Failed to fetch options:", err));

    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) {
      try {
        const t = JSON.parse(cached) as Trip;
        // Verify the cached sheet still exists before resuming.
        gasVerifySheet({ spreadsheetId: t.spreadsheetId, sheetId: t.sheetId })
          .then(({ exists }) => {
            if (!exists) {
              localStorage.removeItem(STORAGE_KEY);
              toast.info("Previous trip sheet was removed. Please start a new trip.");
              return;
            }
            setTrip(t);
            setStep("upload");
          })
          .catch((err) => {
            localStorage.removeItem(STORAGE_KEY);
            toast.info("Could not verify previous trip. Starting fresh.");
            console.error("Verify sheet error:", err);
          });
      } catch {
        // ignore
      }
    }
  }, []);

  const startNewTrip = async () => {
    if (!traveler.trim() || !country.trim() || !fromDate || !toDate) {
      toast.error("Please fill traveler, country and trip dates");
      return;
    }
    setCreating(true);
    try {
      const data = await gasCreateTrip({
        traveler_name: traveler,
        role: role || undefined,
        country,
        purpose: purpose || undefined,
        from_date: fromDate,
        to_date: toDate,
        business_days: businessDays ? Number(businessDays) : undefined,
        itinerary: itinerary.filter((i) => i.destination.trim()),
        user_email: userEmail,
      });

      const t: Trip = {
        spreadsheetId: data.spreadsheetId,
        sheetId: data.sheetId,
        sheetTitle: data.sheetTitle,
        sheetUrl: data.sheetUrl,
        sections: data.sections || [],
        traveler_name: traveler,
        country,
        folderId: data.folderId ?? null,
        folderUrl: data.folderUrl ?? null,
      };
      setTrip(t);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
      setStep("upload");
      toast.success(`✓ Trip sheet created: ${t.sheetTitle}`);
    } catch (e: any) {
      toast.error(e.message || "Could not create trip");
    } finally {
      setCreating(false);
    }
  };

  const [finishing, setFinishing] = useState(false);

  const finishTripAndEmail = async () => {
    if (!trip) return;
    if (!confirm(`Finish this trip and email the report to ${userEmail}?`)) return;
    setFinishing(true);
    try {
      const savedCount = receipts.filter((r) => r.status === "saved").length;
      await gasSendEmail({
        userEmail,
        sheetUrl: trip.sheetUrl,
        sheetTitle: trip.sheetTitle,
        folderUrl: trip.folderUrl || null,
        receiptCount: savedCount,
      });
      toast.success(`✓ Report emailed to ${userEmail}`, {
        description: `${savedCount} expense${savedCount === 1 ? "" : "s"} attached`,
      });

      localStorage.removeItem(STORAGE_KEY);
      setTrip(null);
      setReceipts([]);
      setStep("setup");
      setTraveler(""); setRole(""); setCountry(""); setPurpose("");
      setFromDate(""); setToDate(""); setBusinessDays("");
      setItinerary([{ destination: "", from: "", to: "" }]);
    } catch (e: any) {
      toast.error(e.message || "Could not send the email");
    } finally {
      setFinishing(false);
    }
  };

  // ── receipts: ingest + scan ──
  const addFiles = (files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!arr.length) return;
    const news: Receipt[] = arr.map((f) => ({
      id: crypto.randomUUID(),
      file: f,
      previewUrl: URL.createObjectURL(f),
      status: "pending",
    }));
    setReceipts((prev) => [...prev, ...news]);
    news.forEach(enqueueScan);
  };

  const enqueueScan = (r: Receipt) => {
    scanQueueRef.current = scanQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        await wait(2500);
        await scanReceipt(r);
      });
  };

  const scanReceipt = async (r: Receipt) => {
    updateReceipt(r.id, { status: "scanning" });
    try {
      const base64 = await fileToBase64(r.file);
      // Retry patiently on 429 rate-limit with exponential backoff.
      let data: any, error: any;
      let delay = 15000;
      for (let attempt = 0; attempt < 30; attempt++) {
        try {
          data = await gasAnalyzeReceipt({ imageBase64: base64, mimeType: r.file.type });
          error = undefined;
        } catch (e: any) {
          error = e;
          data = undefined;
        }
        // FunctionsHttpError exposes the response on `error.context`. Read the
        // body so we can detect the 429 (otherwise `error.message` is just
        // "Edge function returned a non-2xx status code").
        let bodyMsg = "";
        if (error?.context && typeof error.context.json === "function") {
          try { const j = await error.context.json(); bodyMsg = j?.error || ""; } catch { /* ignore */ }
        }
        const status = error?.context?.status;
        const msg = (bodyMsg || error?.message || data?.error || "").toString();
        const isRateLimit =
          Boolean(data?.retryable) || status === 429 || msg.includes("Rate limit") || msg.includes("AI is busy") || msg.includes("429");
        if (!isRateLimit) break;
        const retryAfterMs = Number(data?.retryAfterMs) || delay;
        error = undefined;
        data = undefined;
        await wait(retryAfterMs);
        delay = Math.min(delay * 1.5, 120000);
      }
      if (!data && !error) throw new Error("AI is still busy. Please retry this receipt in a few minutes.");
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const e = data.extracted;
      updateReceipt(r.id, {
        status: "ready",
        date: e.date,
        destination: e.destination,
        currency: e.currency,
        amount: e.amount,
        category: e.category,
        payment_method: e.payment_method,
        warnings: data.warnings || [],
      });
    } catch (err: any) {
      updateReceipt(r.id, { status: "error", error: err.message || "Scan failed" });
    }
  };

  const updateReceipt = (id: string, patch: Partial<Receipt>) => {
    setReceipts((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const removeReceipt = (id: string) => {
    setReceipts((prev) => prev.filter((r) => r.id !== id));
  };

  const saveOne = async (r: Receipt) => {
    if (!trip) return;
    if (r.status !== "ready") return;
    updateReceipt(r.id, { status: "saving", error: undefined });
    try {
      // 1) Upload the image to the shared company Google Drive, tagged with
      //    the current worker's email so finance can trace each receipt.
      const base64 = await fileToBase64(r.file);
      const uploadResponse = await gasUploadImageToDrive({
        imageBase64: base64,
        filename: r.file.name,
        userEmail,
        mimeType: r.file.type,
        folderId: trip.folderId,
      });
      const { webViewLink } = uploadResponse;

      // 2) Write the row into the trip sheet (Row 18+), linking to the Drive file.
      const data = await gasSaveExpense({
        spreadsheetId: trip.spreadsheetId,
        sheetId: trip.sheetId,
        date: r.date,
        destination: r.destination,
        currency: r.currency,
        amount: r.amount,
        category: r.category,
        payment_method: r.payment_method,
        drive_url: webViewLink,
      });
      
      updateReceipt(r.id, { status: "saved", driveUrl: webViewLink, savedRow: data?.row });
      toast.success("✓ Expense saved", {
        description: r.file.name,
        action: {
          label: "View in Drive",
          onClick: () => window.open(webViewLink, "_blank", "noopener"),
        },
      });
    } catch (e: any) {
      const msg = e.message || "Save failed";
      updateReceipt(r.id, { status: "error", error: msg });
      if (msg.includes("No grid with id") || msg.includes("not found in sheet")) {
        toast.error("This trip sheet no longer exists. Starting a new trip.");
        localStorage.removeItem(STORAGE_KEY);
        setTrip(null);
        setReceipts([]);
        setStep("setup");
      }
    }
  };

  const saveAll = async () => {
    const ready = receipts.filter((r) => r.status === "ready");
    if (!ready.length) return toast.info("No scanned receipts ready to save");
    // Process in parallel batches ("multiple workers"). Drive uploads can run
    // concurrently; we keep the batch small to stay friendly to Sheets writes.
    const WORKERS = 3;
    for (let i = 0; i < ready.length; i += WORKERS) {
      // eslint-disable-next-line no-await-in-loop
      await Promise.all(ready.slice(i, i + WORKERS).map((r) => saveOne(r)));
    }
    toast.success(`✓ All ${ready.length} expense${ready.length === 1 ? "" : "s"} saved!`, {
      description: "Data is now in your trip sheet",
    });
  };

  // ── render ──
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {step === "setup" && (
        <Card className="p-6 shadow-[var(--shadow-elegant)]">
          <div className="mb-5 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <div>
              <h3 className="font-semibold">New trip — guided setup</h3>
              <p className="text-sm text-muted-foreground">
                We'll create a fresh copy of the company expense sheet, fill in your trip details, then let you drop receipts.
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Traveler name *">
              <Input value={traveler} onChange={(e) => setTraveler(e.target.value)} placeholder="Jane Cohen" />
            </Field>
            <Field label="Role">
              <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Sales Lead" />
            </Field>
            <Field label="Country *">
              <Input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Japan" />
            </Field>
            <Field label="Trip purpose">
              <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Customer visits" />
            </Field>
            <Field label="From *">
              <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </Field>
            <Field label="To *">
              <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </Field>
            <Field label="Business days">
              <Input
                type="text"
                disabled
                value="Auto-calculated"
                className="text-muted-foreground"
              />
            </Field>
          </div>

          <div className="mt-6">
            <div className="mb-2 flex items-center justify-between">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Itinerary</Label>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setItinerary((it) => [...it, { destination: "", from: "", to: "" }])}
                disabled={itinerary.length >= 5}
              >
                <Plus className="mr-1 h-3 w-3" /> Add stop
              </Button>
            </div>
            <div className="space-y-2">
              {itinerary.map((it, i) => (
                <div key={i} className="grid grid-cols-[1fr_9rem_9rem_2rem] gap-2">
                  <Input
                    placeholder="Destination (e.g. Tokyo)"
                    value={it.destination}
                    onChange={(e) =>
                      setItinerary((arr) => arr.map((x, idx) => (idx === i ? { ...x, destination: e.target.value } : x)))
                    }
                  />
                  <Input
                    type="date"
                    value={it.from}
                    onChange={(e) => setItinerary((arr) => arr.map((x, idx) => (idx === i ? { ...x, from: e.target.value } : x)))}
                  />
                  <Input
                    type="date"
                    value={it.to}
                    onChange={(e) => setItinerary((arr) => arr.map((x, idx) => (idx === i ? { ...x, to: e.target.value } : x)))}
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => setItinerary((arr) => arr.filter((_, idx) => idx !== i))}
                    disabled={itinerary.length === 1}
                    aria-label="Remove stop"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 flex justify-end">
            <Button size="lg" onClick={startNewTrip} disabled={creating}>
              {creating ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating trip sheet…</>
              ) : (
                <>Create trip & start uploading</>
              )}
            </Button>
          </div>
        </Card>
      )}

      {step === "upload" && trip && options && (
        <>
          <Card className="flex flex-wrap items-center justify-between gap-3 border-primary/20 bg-primary/5 p-4">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Active trip</p>
              <p className="truncate font-medium">{trip.sheetTitle}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" asChild>
                <a href={trip.sheetUrl} target="_blank" rel="noreferrer">
                  Open sheet <ExternalLink className="ml-1 h-3 w-3" />
                </a>
              </Button>
              <Button variant="default" size="sm" onClick={finishTripAndEmail} disabled={finishing}>
                {finishing ? (
                  <><Loader2 className="mr-1 h-3 w-3 animate-spin" /> Sending…</>
                ) : (
                  <>Finish & email me the report</>
                )}
              </Button>
            </div>
          </Card>

          <Card
            className="overflow-hidden shadow-[var(--shadow-elegant)]"
            onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
            onDragOver={(e) => e.preventDefault()}
          >
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex w-full flex-col items-center gap-2 border-b bg-[var(--gradient-subtle)] py-12 transition-colors hover:bg-accent/40 sm:py-10"
            >
              <div className="rounded-full bg-primary/10 p-5 text-primary sm:p-4">
                <Upload className="h-8 w-8 sm:h-6 sm:w-6" />
              </div>
              <p className="text-center font-semibold text-lg sm:font-medium sm:text-base">
                📷 Scan receipts
              </p>
              <p className="text-center text-xs text-muted-foreground">
                Drop photos here or tap to upload
              </p>
              <p className="text-[10px] text-muted-foreground/70">
                Multiple at once · AI auto-categorizes
              </p>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => e.target.files && addFiles(e.target.files)}
              />
            </button>

            {receipts.length > 0 && (
              <div className="flex flex-col gap-3 border-b bg-muted/30 px-5 py-4 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-2 sm:py-3">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <FileImage className="h-4 w-4" />
                  <span>
                    {receipts.length} receipt{receipts.length === 1 ? "" : "s"} ·{" "}
                    {receipts.filter((r) => r.status === "saved").length} saved
                  </span>
                </div>
                <Button
                  size="sm"
                  onClick={saveAll}
                  disabled={!receipts.some((r) => r.status === "ready")}
                >
                  Save all ready receipts
                </Button>
              </div>
            )}

            <div className="divide-y">
              {receipts.map((r) => (
                <ReceiptRow
                  key={r.id}
                  receipt={r}
                  options={options}
                  onChange={(patch) => updateReceipt(r.id, patch)}
                  onSave={() => saveOne(r)}
                  onRemove={() => removeReceipt(r.id)}
                  onRetry={() => enqueueScan(r)}
                />
              ))}
              {receipts.length === 0 && (
                <p className="p-8 text-center text-sm text-muted-foreground">
                  No receipts yet — drop a photo above to get started.
                </p>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
};

const ReceiptRow = ({
  receipt: r,
  options,
  onChange,
  onSave,
  onRemove,
  onRetry,
}: {
  receipt: Receipt;
  options: Options;
  onChange: (patch: Partial<Receipt>) => void;
  onSave: () => void;
  onRemove: () => void;
  onRetry: () => void;
}) => {
  const isDone = r.status === "saved";
  return (
    <div className="grid grid-cols-[5rem_1fr_auto] gap-4 p-4">
      <img
        src={r.previewUrl}
        alt="Receipt"
        className="h-20 w-20 rounded-md border bg-white object-cover"
      />
      <div className="min-w-0">
        {r.status === "scanning" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Reading receipt…
          </div>
        )}

        {r.status === "pending" && (
          <div className="text-sm text-muted-foreground">
            Queued — waiting for the scanner…
          </div>
        )}

        {r.status === "error" && (
          <div className="text-sm text-destructive">
            {r.error || "Something went wrong"}
            <Button size="sm" variant="ghost" className="ml-2" onClick={onRetry}>Retry</Button>
          </div>
        )}

        {(r.status === "ready" || r.status === "saving" || r.status === "saved") && (
          <div className="grid gap-2 sm:grid-cols-6">
            {r.warnings && r.warnings.length > 0 && !isDone && (
              <div className="sm:col-span-6 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-900">
                ⚠ {r.warnings.join(" ")}
              </div>
            )}
            <div className="sm:col-span-2">
              <MiniLabel>Category</MiniLabel>
              <Select
                value={r.category}
                onValueChange={(v) => onChange({ category: v })}
                disabled={isDone}
              >
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {options.categories.map((c) => (
                    <SelectItem key={c} value={c} dir="rtl">{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <MiniLabel>Date</MiniLabel>
              <Input
                type="date"
                className="h-8 text-xs"
                value={r.date || ""}
                onChange={(e) => onChange({ date: e.target.value })}
                disabled={isDone}
              />
            </div>
            <div>
              <MiniLabel>Currency</MiniLabel>
              <Select
                value={r.currency}
                onValueChange={(v) => onChange({ currency: v })}
                disabled={isDone}
              >
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {options.currencies.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <MiniLabel>Amount</MiniLabel>
              <Input
                type="number"
                step="0.01"
                className="h-8 text-xs"
                value={r.amount ?? ""}
                onChange={(e) => onChange({ amount: Number(e.target.value) })}
                disabled={isDone}
              />
            </div>
            <div>
              <MiniLabel>Paid by</MiniLabel>
              <Select
                value={r.payment_method}
                onValueChange={(v) => onChange({ payment_method: v as "company_card" | "employee" })}
                disabled={isDone}
              >
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {options.payment_methods.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-6">
              <MiniLabel>Destination / merchant</MiniLabel>
              <Input
                className="h-8 text-xs"
                value={r.destination || ""}
                onChange={(e) => onChange({ destination: e.target.value })}
                disabled={isDone}
              />
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-col items-end gap-2">
        {r.status === "saved" ? (
          <div className="flex items-center gap-2 rounded-md bg-success/10 px-3 py-2 text-xs font-medium text-success">
            <CheckCircle2 className="h-4 w-4" />
            <span>✓ Row {r.savedRow} saved</span>
          </div>
        ) : (
          <Button
            size="sm"
            onClick={onSave}
            disabled={r.status !== "ready"}
            className={r.status === "saving" ? "bg-blue-500 hover:bg-blue-600" : ""}
          >
            {r.status === "saving" ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                <span className="font-semibold">Uploading...</span>
              </>
            ) : r.status === "error" ? (
              "Save to sheet"
            ) : (
              "💾 Save"
            )}
          </Button>
        )}
        {!isDone && (
          <Button size="icon" variant="ghost" onClick={onRemove} aria-label="Remove receipt">
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
};

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
    <div className="mt-1">{children}</div>
  </div>
);

const MiniLabel = ({ children }: { children: React.ReactNode }) => (
  <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">{children}</span>
);

const fileToBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve((r.result as string).split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
