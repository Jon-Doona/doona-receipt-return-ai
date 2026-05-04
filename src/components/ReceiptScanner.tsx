import { useMemo, useRef, useState } from "react";
import { CheckCircle2, FileImage, Plus, Sparkles, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { DEFAULT_EXCHANGE_RATES, downloadExpenseWorkbook, type ExchangeRate } from "@/lib/reportWorkbook";

type Options = {
  categories: string[];
  currencies: string[];
  payment_methods: { id: string; label: string }[];
};

type Trip = {
  sheetTitle: string;
  travelerName: string;
  country: string;
  purpose: string;
  fromDate: string;
  toDate: string;
};

type Itinerary = { destination: string; from: string; to: string };

type Receipt = {
  id: string;
  file: File;
  previewUrl: string;
  status: "ready" | "saved" | "error";
  error?: string;
  date?: string;
  destination?: string;
  currency?: string;
  amount?: number;
  category?: string;
  payment_method?: "company_card" | "employee";
  savedRow?: number;
};

type ReceiptScannerProps = { userEmail: string };

export const ReceiptScanner = ({ userEmail }: ReceiptScannerProps) => {
  const options: Options = useMemo(
    () => ({
      categories: ["Flight", "Hotel", "Ground Transport", "Meals", "Office / Supplies", "Other"],
      currencies: ["ILS", "USD", "EUR", "GBP", "JPY", "THB", "CAD"],
      payment_methods: [
        { id: "company_card", label: "Company card" },
        { id: "employee", label: "Employee" },
      ],
    }),
    [],
  );

  const [step, setStep] = useState<"setup" | "upload">("setup");
  const [trip, setTrip] = useState<Trip | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [exchangeRates, setExchangeRates] = useState<ExchangeRate[]>(DEFAULT_EXCHANGE_RATES);
  const fileRef = useRef<HTMLInputElement>(null);

  const [traveler, setTraveler] = useState("");
  const [role, setRole] = useState("");
  const [country, setCountry] = useState("");
  const [purpose, setPurpose] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [itinerary, setItinerary] = useState<Itinerary[]>([{ destination: "", from: "", to: "" }]);

  const startNewTrip = () => {
    if (!traveler.trim() || !country.trim() || !fromDate || !toDate) {
      toast.error("Please fill traveler, country and trip dates");
      return;
    }

    setTrip({
      sheetTitle: `${traveler} - ${country} - ${fromDate}`,
      travelerName: traveler,
      country,
      purpose,
      fromDate,
      toDate,
    });
    setStep("upload");
    toast.success("Trip initialized in local mode");
  };

  const addFiles = (files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!arr.length) return;
    const today = new Date().toISOString().slice(0, 10);
    const news: Receipt[] = arr.map((f) => ({
      id: crypto.randomUUID(),
      file: f,
      previewUrl: URL.createObjectURL(f),
      status: "ready",
      date: today,
      destination: "",
      currency: "ILS",
      category: options.categories[0],
      payment_method: "company_card",
    }));
    setReceipts((prev) => [...prev, ...news]);
  };

  const updateReceipt = (id: string, patch: Partial<Receipt>) => {
    setReceipts((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const removeReceipt = (id: string) => {
    setReceipts((prev) => prev.filter((r) => r.id !== id));
  };

  const isReceiptReadyToStage = (r: Receipt) =>
    Boolean(
      r.date &&
        r.destination &&
        r.currency &&
        r.category &&
        r.payment_method &&
        r.amount !== undefined &&
        r.amount !== null &&
        !Number.isNaN(r.amount),
    );

  const saveOne = (r: Receipt) => {
    if (!isReceiptReadyToStage(r)) {
      updateReceipt(r.id, { status: "error", error: "Fill all fields before staging" });
      return;
    }
    setReceipts((prev) => {
      const alreadySaved = prev.find((x) => x.id === r.id)?.status === "saved";
      const nextRow = alreadySaved ? prev.find((x) => x.id === r.id)?.savedRow : 28 + prev.filter((x) => x.status === "saved").length;
      return prev.map((x) =>
        x.id === r.id ? { ...x, status: "saved", savedRow: nextRow, error: undefined } : x,
      );
    });
  };

  const saveAll = () => {
    let nextSavedCount = receipts.filter((r) => r.status === "saved").length;
    let stagedNow = 0;
    let failedNow = 0;

    const next = receipts.map((r) => {
      if (r.status !== "ready") return r;

      if (!isReceiptReadyToStage(r)) {
        failedNow += 1;
        return { ...r, status: "error", error: "Fill all fields before staging" };
      }

      const row = 28 + nextSavedCount;
      nextSavedCount += 1;
      stagedNow += 1;
      return { ...r, status: "saved", savedRow: row, error: undefined };
    });

    setReceipts(next);

    if (stagedNow > 0 && failedNow === 0) {
      toast.success(`Staged ${stagedNow} receipt${stagedNow === 1 ? "" : "s"} for export`);
    } else if (stagedNow > 0 && failedNow > 0) {
      toast.warning(
        `Staged ${stagedNow} receipt${stagedNow === 1 ? "" : "s"}, ${failedNow} need${failedNow === 1 ? "s" : ""} fixes`,
      );
    } else if (failedNow > 0) {
      toast.error(`No receipts staged. ${failedNow} receipt${failedNow === 1 ? "" : "s"} need fixes`);
    } else {
      toast.info("No ready receipts to stage");
    }
  };

  const exportReport = () => {
    if (!trip) return;
    const expenses = receipts
      .filter((r) => r.status === "saved")
      .map((r) => ({
        date: r.date || "",
        merchant: r.destination || "",
        currency: r.currency || "ILS",
        amount: r.amount || 0,
        category: r.category || "Other",
        paymentMethod: (r.payment_method || "company_card") as "company_card" | "employee",
        receiptName: r.file.name,
      }));

    if (!expenses.length) {
      toast.info("Stage at least one receipt before export");
      return;
    }

    downloadExpenseWorkbook(
      {
        travelerName: trip.travelerName,
        country: trip.country,
        purpose: trip.purpose,
        fromDate: trip.fromDate,
        toDate: trip.toDate,
      },
      expenses,
      exchangeRates,
    );
    toast.success(`Spreadsheet downloaded for ${userEmail}`);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {step === "setup" && (
        <Card className="p-6 shadow-[var(--shadow-elegant)]">
          <div className="mb-5 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <div>
              <h3 className="font-semibold">New trip — local mode</h3>
              <p className="text-sm text-muted-foreground">
                Browser-only flow for GitHub Pages. No server calls, no backend dependency.
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
            <Button size="lg" onClick={startNewTrip}>Create trip & start uploading</Button>
          </div>
        </Card>
      )}

      {step === "upload" && trip && (
        <>
          <Card className="flex flex-wrap items-center justify-between gap-3 border-primary/20 bg-primary/5 p-4">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Active trip</p>
              <p className="truncate font-medium">{trip.sheetTitle}</p>
              <p className="text-xs text-muted-foreground">Country B13 · Purpose D13 · Dates F13/G13 · Expenses from row 28</p>
            </div>
            <Button variant="default" size="sm" onClick={exportReport}>Download spreadsheet report</Button>
          </Card>

          <Card className="p-4">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Exchange rates (H5:I10)</Label>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {exchangeRates.map((rate, idx) => (
                <div key={`${idx}-${rate.currency}`} className="flex items-center gap-2 rounded-md border p-2">
                  <Input
                    className="h-8 text-xs"
                    value={rate.currency}
                    maxLength={3}
                    onChange={(e) =>
                      setExchangeRates((prev) =>
                        prev.map((x, i) => (i === idx ? { ...x, currency: e.target.value.toUpperCase() } : x)),
                      )
                    }
                  />
                  <Input
                    className="h-8 text-xs"
                    type="number"
                    step="0.0001"
                    value={rate.rateToIls}
                    onChange={(e) =>
                      setExchangeRates((prev) =>
                        prev.map((x, i) => (i === idx ? { ...x, rateToIls: Number(e.target.value) || 0 } : x)),
                      )
                    }
                  />
                </div>
              ))}
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
              className="flex w-full flex-col items-center gap-2 border-b bg-[var(--gradient-subtle)] py-10 transition-colors hover:bg-accent/40"
            >
              <div className="rounded-full bg-primary/10 p-4 text-primary">
                <Upload className="h-6 w-6" />
              </div>
              <p className="font-medium">Drop receipts here, or click to upload</p>
              <p className="text-xs text-muted-foreground">Manual edit + local spreadsheet export</p>
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
              <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-5 py-3 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <FileImage className="h-4 w-4" />
                  {receipts.length} receipt{receipts.length === 1 ? "" : "s"} ·{" "}
                  {receipts.filter((r) => r.status === "saved").length} staged
                </div>
                <Button size="sm" onClick={saveAll} disabled={!receipts.some((r) => r.status === "ready")}>
                  Stage all ready receipts
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
}: {
  receipt: Receipt;
  options: Options;
  onChange: (patch: Partial<Receipt>) => void;
  onSave: () => void;
  onRemove: () => void;
}) => {
  const isDone = r.status === "saved";
  return (
    <div className="grid grid-cols-[5rem_1fr_auto] gap-4 p-4">
      <Dialog>
        <DialogTrigger asChild>
          <button
            type="button"
            className="group relative h-20 w-20 overflow-hidden rounded-md border bg-white"
            aria-label="View receipt in detail"
          >
            <img src={r.previewUrl} alt="Receipt" className="h-full w-full object-cover transition-transform group-hover:scale-105" />
            <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-[10px] font-medium text-transparent transition-colors group-hover:bg-black/40 group-hover:text-white">
              View
            </span>
          </button>
        </DialogTrigger>
        <DialogContent className="max-w-3xl p-2">
          <div className="max-h-[85vh] overflow-auto">
            <img src={r.previewUrl} alt="Receipt full size" className="mx-auto h-auto w-full object-contain" />
          </div>
        </DialogContent>
      </Dialog>
      <div className="min-w-0">
        {r.status === "error" && <div className="text-sm text-destructive">{r.error || "Something went wrong"}</div>}
        {(r.status === "ready" || r.status === "saved" || r.status === "error") && (
          <div className="grid gap-2 sm:grid-cols-6">
            <div className="sm:col-span-2">
              <MiniLabel>Category</MiniLabel>
              <Select value={r.category} onValueChange={(v) => onChange({ category: v })} disabled={isDone}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {options.categories.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
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
              <Select value={r.currency} onValueChange={(v) => onChange({ currency: v })} disabled={isDone}>
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
              <Select value={r.payment_method} onValueChange={(v) => onChange({ payment_method: v as "company_card" | "employee" })} disabled={isDone}>
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
          <Badge variant="secondary" className="gap-1">
            <CheckCircle2 className="h-3 w-3 text-success" /> Row {r.savedRow}
          </Badge>
        ) : (
          <Button size="sm" onClick={onSave}>Stage receipt</Button>
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
