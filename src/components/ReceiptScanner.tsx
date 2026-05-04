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
  status: "scanning" | "ready" | "saved" | "error";
  error?: string;
  date?: string;
  merchant?: string;
  destination?: string;
  currency?: string;
  amount?: number;
  category?: string;
  payment_method?: "company_card" | "employee";
  savedRow?: number;
};

type ReceiptScannerProps = { userEmail: string };

const ENV = import.meta.env as Record<string, string | undefined>;
const OPENAI_API_KEY = ENV.VITE_OPENAI_API_KEY || ENV.OPENAI_API_KEY;

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

  const analyzeReceiptWithOpenAI = async (file: File) => {
    if (!OPENAI_API_KEY) {
      throw new Error("Missing OPENAI_API_KEY in environment");
    }

    const imageDataUrl = await fileToDataUrl(file);
    // תיקון ה-Endpoint והמודל עבור Client-side analysis
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Extract receipt fields from the image. Return ONLY a JSON object with keys: merchant, location, date, currency, amount, category, payment_method. location should be City/Country. Date: YYYY-MM-DD. Amount: numeric."
              },
              {
                type: "image_url",
                image_url: { url: imageDataUrl }
              },
            ],
          },
        ],
        response_format: { type: "json_object" }
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI extraction failed (${response.status})`);
    }

    const data = await response.json();
    const parsed = JSON.parse(data.choices[0].message.content);

    return {
      merchant: String(parsed.merchant || "").trim(),
      location: String(parsed.location || "").trim(),
      date: String(parsed.date || "").trim(),
      currency: String(parsed.currency || "ILS").toUpperCase(),
      amount: typeof parsed.amount === "number" ? parsed.amount : Number.parseFloat(String(parsed.amount ?? "").replace(/[^\d.-]/g, "")),
      category: String(parsed.category || ""),
      payment_method: parsed.payment_method === "employee" ? "employee" : "company_card",
    };
  };

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
    toast.success("Trip initialized");
  };

  const addFiles = (files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!arr.length) return;
    const today = new Date().toISOString().slice(0, 10);
    
    const news: Receipt[] = arr.map((f) => ({
      id: crypto.randomUUID(),
      file: f,
      previewUrl: URL.createObjectURL(f),
      status: "scanning",
      date: today,
      merchant: "",
      destination: "",
      currency: "ILS",
      category: options.categories[0],
      payment_method: "company_card",
    }));
    
    setReceipts((prev) => [...prev, ...news]);

    news.forEach(async (receipt) => {
      try {
        const extracted = await analyzeReceiptWithOpenAI(receipt.file);
        updateReceipt(receipt.id, {
          status: "ready",
          merchant: extracted.merchant,
          destination: extracted.location,
          date: extracted.date || today,
          currency: extracted.currency || "ILS",
          amount: Number.isFinite(extracted.amount) ? extracted.amount : 0,
          category: options.categories.includes(extracted.category) ? extracted.category : options.categories[0],
          payment_method: extracted.payment_method as "company_card" | "employee",
          error: undefined,
        });
      } catch (error: any) {
        updateReceipt(receipt.id, {
          status: "error",
          error: "Could not analyze receipt. Please fill manually.",
        });
      }
    });
  };

  const updateReceipt = (id: string, patch: Partial<Receipt>) => {
    setReceipts((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const removeReceipt = (id: string) => {
    setReceipts((prev) => prev.filter((r) => r.id !== id));
  };

  const isReceiptReadyToStage = (r: Receipt) => 
    Boolean(r.merchant && r.destination && r.amount !== undefined && !Number.isNaN(r.amount));

  const saveOne = (id: string) => {
    setReceipts((prev) => {
      const target = prev.find(r => r.id === id);
      if (!target || !isReceiptReadyToStage(target)) {
        toast.error("Please fill all required fields");
        return prev;
      }
      
      const savedCount = prev.filter(r => r.status === "saved").length;
      return prev.map(r => r.id === id ? { ...r, status: "saved", savedRow: 28 + savedCount } : r);
    });
  };

  const saveAll = () => {
    let savedCount = receipts.filter(r => r.status === "saved").length;
    let stagedNow = 0;

    setReceipts(prev => prev.map(r => {
      if (r.status === "ready" && isReceiptReadyToStage(r)) {
        const row = 28 + savedCount;
        savedCount++;
        stagedNow++;
        return { ...r, status: "saved", savedRow: row };
      }
      return r;
    }));

    if (stagedNow > 0) toast.success(`Staged ${stagedNow} receipts`);
  };

  const exportReport = () => {
    if (!trip) return;
    const expenses = receipts
      .filter((r) => r.status === "saved")
      .map((r) => ({
        date: r.date || "",
        merchant: r.merchant || "",
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
    toast.success("Spreadsheet downloaded");
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4">
      {step === "setup" && (
        <Card className="p-6">
          <div className="mb-5 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h3 className="font-semibold">New Trip Setup</h3>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Traveler Name *"><Input value={traveler} onChange={(e) => setTraveler(e.target.value)} /></Field>
            <Field label="Country *"><Input value={country} onChange={(e) => setCountry(e.target.value)} /></Field>
            <Field label="Purpose"><Input value={purpose} onChange={(e) => setPurpose(e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="From *"><Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></Field>
              <Field label="To *"><Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></Field>
            </div>
          </div>

          <Button className="mt-6 w-full" onClick={startNewTrip}>Start Uploading</Button>
        </Card>
      )}

      {step === "upload" && trip && (
        <>
          <Card className="flex items-center justify-between p-4 bg-primary/5 border-primary/20">
            <div>
              <p className="text-xs font-bold uppercase text-muted-foreground">Active Trip</p>
              <p className="font-medium">{trip.sheetTitle}</p>
            </div>
            <Button onClick={exportReport}>Download XLSX</Button>
          </Card>

          <Card className="p-4">
            <Label className="text-xs font-bold uppercase text-muted-foreground">Exchange Rates (H5:I10)</Label>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {exchangeRates.map((rate, idx) => (
                <div key={idx} className="flex gap-1">
                  <Input className="h-8 w-12 text-center text-xs" value={rate.currency} readOnly />
                  <Input 
                    className="h-8 text-xs" 
                    type="number" 
                    value={rate.rateToIls} 
                    onChange={(e) => setExchangeRates(prev => prev.map((r, i) => i === idx ? {...r, rateToIls: Number(e.target.value)} : r))}
                  />
                </div>
              ))}
            </div>
          </Card>

          <Card 
            className="border-dashed border-2 p-10 text-center hover:bg-accent/50 cursor-pointer"
            onClick={() => fileRef.current?.click()}
            onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
            onDragOver={(e) => e.preventDefault()}
          >
            <Upload className="mx-auto h-10 w-10 text-muted-foreground mb-2" />
            <p className="font-medium">Click or drop receipts to analyze</p>
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => e.target.files && addFiles(e.target.files)} />
          </Card>

          {receipts.length > 0 && (
            <div className="flex justify-between items-center px-2">
              <span className="text-sm text-muted-foreground">{receipts.length} total · {receipts.filter(r => r.status === "saved").length} staged</span>
              <Button size="sm" variant="outline" onClick={saveAll}>Stage All Ready</Button>
            </div>
          )}

          <div className="space-y-4">
            {receipts.map((r) => (
              <ReceiptRow key={r.id} receipt={r} options={options} onChange={(p) => updateReceipt(r.id, p)} onSave={() => saveOne(r.id)} onRemove={() => removeReceipt(r.id)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
};

const ReceiptRow = ({ receipt: r, options, onChange, onSave, onRemove }: any) => {
  const isDone = r.status === "saved";
  return (
    <Card className={`p-4 ${isDone ? 'bg-secondary/20' : ''}`}>
      <div className="flex gap-4">
        <div className="h-20 w-20 flex-shrink-0 border rounded overflow-hidden">
          <img src={r.previewUrl} className="h-full w-full object-cover" alt="Preview" />
        </div>
        <div className="flex-grow grid gap-2 sm:grid-cols-3">
          <Field label="Merchant"><Input className="h-8" value={r.merchant} onChange={e => onChange({merchant: e.target.value})} disabled={isDone} /></Field>
          <Field label="Destination"><Input className="h-8" value={r.destination} onChange={e => onChange({destination: e.target.value})} disabled={isDone} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Currency">
              <Select value={r.currency} onValueChange={v => onChange({currency: v})} disabled={isDone}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>{options.currencies.map((c: string) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Amount"><Input className="h-8" type="number" value={r.amount} onChange={e => onChange({amount: Number(e.target.value)})} disabled={isDone} /></Field>
          </div>
        </div>
        <div className="flex flex-col justify-between items-end">
          <Button size="icon" variant="ghost" onClick={onRemove} disabled={isDone}><Trash2 className="h-4 w-4" /></Button>
          {isDone ? (
            <Badge variant="outline" className="text-success border-success">Row {r.savedRow}</Badge>
          ) : (
            <Button size="sm" onClick={onSave} disabled={r.status === "scanning"}>Stage</Button>
          )}
        </div>
      </div>
      {r.status === "scanning" && <div className="mt-2 text-[10px] text-blue-500 animate-pulse">AI is reading receipt...</div>}
      {r.status === "error" && <div className="mt-2 text-[10px] text-destructive">{r.error}</div>}
    </Card>
  );
};

const Field = ({ label, children }: any) => (
  <div className="space-y-1">
    <Label className="text-[10px] uppercase font-bold text-muted-foreground">{label}</Label>
    {children}
  </div>
);

const fileToDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ""));
  reader.onerror = () => reject(new Error("Could not read image"));
  reader.readAsDataURL(file);
});