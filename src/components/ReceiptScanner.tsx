import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Loader2, Check, Plane, Edit3, Trash2, Plus, Camera } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { scanReceipt, saveExpense, saveTripHeader, convertToILS, CURRENCY_TO_ILS_RATES } from "@/lib/api";

const CATEGORIES = [
  "ארוחות", "טיסות", "נסיעות בתחבורה ציבורית", "לינה ללא ארוחות",
  "השכרת רכב", "אירוח אורחים בחול", "תקשורת", "הוצאות שונות", "ללא קבלות",
];
const CURRENCIES = Object.keys(CURRENCY_TO_ILS_RATES);

type CardStatus = 'queued' | 'scanning' | 'ready' | 'editing' | 'saving' | 'approved' | 'error';

interface ReceiptCard {
  id: string;
  file: File;
  preview: string;
  status: CardStatus;
  error?: string;
  amount_ils: string;
  original_amount: string;
  original_currency: string;
  description: string;
  date: string;
  category: string;
}

interface Props { userEmail: string }

const fileToBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve((r.result as string).split(',')[1]);
  r.onerror = reject;
  r.readAsDataURL(file);
});
const fileToDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result as string);
  r.onerror = reject;
  r.readAsDataURL(file);
});

export const ReceiptScanner = ({ userEmail }: Props) => {
  const { toast } = useToast();
  const [step, setStep] = useState<'details' | 'scanner'>('details');
  const [headerSaving, setHeaderSaving] = useState(false);
  const [trip, setTrip] = useState({
    userName: 'Jonathan Zvi Shmuely',
    jobTitle: '',
    tripPurpose: '',
    destination: '',
    startDate: new Date().toISOString().split('T')[0],
    returnDate: '',
  });

  const [cards, setCards] = useState<ReceiptCard[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  // Background scan worker — scans the next 'scanning' card without blocking UI.
  const scanQueueRef = useRef<string[]>([]);
  const workingRef = useRef(false);

  const updateCard = useCallback((id: string, patch: Partial<ReceiptCard>) => {
    setCards(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c));
  }, []);

  const drainQueue = useCallback(async () => {
    if (workingRef.current) return;
    workingRef.current = true;
    try {
      while (scanQueueRef.current.length) {
        const id = scanQueueRef.current.shift()!;
        const card = cardsRef.current.find(c => c.id === id);
        if (!card) continue;
        // Sequential: mark this card as scanning only when it's actually its turn.
        updateCard(id, { status: 'scanning' });
        try {
          const base64 = await fileToBase64(card.file);
          const data = await scanReceipt(base64, card.file.type || 'image/jpeg');
          const origAmt = Number(data?.amount) || 0;
          const cur = (data?.currency || 'ILS').toUpperCase();
          const ils = convertToILS(origAmt, cur);
          updateCard(id, {
            status: 'ready',
            amount_ils: ils ? String(ils) : '',
            original_amount: origAmt ? String(origAmt) : '',
            original_currency: cur,
            description: data?.description || '',
            date: data?.date || new Date().toISOString().split('T')[0],
            category: data?.category && CATEGORIES.includes(data.category) ? data.category : 'ארוחות',
          });
        } catch (e) {
          updateCard(id, { status: 'error', error: (e as Error).message });
        }
      }
    } finally {
      workingRef.current = false;
    }
  }, [updateCard]);

  // Keep ref in sync so the worker sees the latest cards array.
  const cardsRef = useRef<ReceiptCard[]>([]);
  useEffect(() => { cardsRef.current = cards; }, [cards]);

  const enqueue = (id: string) => {
    scanQueueRef.current.push(id);
    void drainQueue();
  };

  const onFiles = async (files: File[]) => {
    if (!files.length) return;
    const newCards: ReceiptCard[] = await Promise.all(files.map(async (f) => ({
      id: crypto.randomUUID(),
      file: f,
      preview: await fileToDataUrl(f),
      status: 'queued' as CardStatus,
      amount_ils: '',
      original_amount: '',
      original_currency: 'ILS',
      description: '',
      date: new Date().toISOString().split('T')[0],
      category: 'ארוחות',
    })));
    setCards(prev => [...prev, ...newCards]);
    newCards.forEach(c => enqueue(c.id));
    toast({ title: `📥 ${files.length} added`, description: 'Scanning in background…' });
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (e.target) e.target.value = '';
    void onFiles(files);
  };

  const startTrip = async () => {
    if (!trip.destination) return;
    setHeaderSaving(true);
    try {
      try {
        await saveTripHeader({ ...trip, email: userEmail });
      } catch (e) {
        // Non-fatal — user may not have GAS configured yet for headers
        console.warn('saveTripHeader failed', e);
      }
      setStep('scanner');
    } finally {
      setHeaderSaving(false);
    }
  };

  const updateField = (id: string, field: keyof ReceiptCard, value: string) => {
    setCards(prev => prev.map(c => {
      if (c.id !== id) return c;
      const next = { ...c, [field]: value } as ReceiptCard;
      if (field === 'original_amount' || field === 'original_currency') {
        const amt = Number(field === 'original_amount' ? value : next.original_amount) || 0;
        const cur = field === 'original_currency' ? value : next.original_currency;
        const ils = convertToILS(amt, cur);
        next.amount_ils = ils ? String(ils) : '';
      }
      return next;
    }));
  };

  const approveCard = async (id: string) => {
    const c = cardsRef.current.find(x => x.id === id);
    if (!c) return;
    if (!c.amount_ils || !c.description) {
      toast({ title: 'Missing fields', description: 'Amount and description are required.', variant: 'destructive' });
      return;
    }
    updateCard(id, { status: 'saving' });
    try {
      await saveExpense({
        date: c.date,
        category: c.category,
        amount_ils: c.amount_ils,
        original_amount: c.original_amount,
        original_currency: c.original_currency,
        description: c.description,
        destination: trip.destination,
        email: userEmail,
      });
      updateCard(id, { status: 'approved' });
      toast({ title: '✓ Saved', description: c.description });
    } catch (e) {
      updateCard(id, { status: 'ready', error: (e as Error).message });
      toast({ title: 'Save failed', description: (e as Error).message, variant: 'destructive' });
    }
  };

  const deleteCard = (id: string) => {
    setCards(prev => prev.filter(c => c.id !== id));
  };

  const retryScan = (id: string) => {
    updateCard(id, { status: 'queued', error: undefined });
    enqueue(id);
  };

  if (step === 'details') {
    return (
      <Card className="p-8 max-w-xl mx-auto space-y-6 shadow-2xl border-t-8 border-blue-600">
        <div className="flex flex-col items-center gap-2">
          <Plane className="h-10 w-10 text-blue-600" />
          <h2 className="text-2xl font-bold">Trip Setup</h2>
        </div>
        <div className="space-y-4 text-left">
          <div className="grid gap-2"><Label>Full Name</Label>
            <Input value={trip.userName} onChange={(e) => setTrip({ ...trip, userName: e.target.value })} /></div>
          <div className="grid gap-2"><Label>Job Title</Label>
            <Input value={trip.jobTitle} onChange={(e) => setTrip({ ...trip, jobTitle: e.target.value })} placeholder="e.g. Product Manager" /></div>
          <div className="grid gap-2"><Label>Destination</Label>
            <Input value={trip.destination} onChange={(e) => setTrip({ ...trip, destination: e.target.value })} placeholder="City/Country" /></div>
          <div className="grid gap-2"><Label>Trip Purpose</Label>
            <Input value={trip.tripPurpose} onChange={(e) => setTrip({ ...trip, tripPurpose: e.target.value })} placeholder="e.g. Client meeting, Conference" /></div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2"><Label>Departure</Label>
              <Input type="date" value={trip.startDate} onChange={(e) => setTrip({ ...trip, startDate: e.target.value })} /></div>
            <div className="grid gap-2"><Label>Return</Label>
              <Input type="date" value={trip.returnDate} onChange={(e) => setTrip({ ...trip, returnDate: e.target.value })} /></div>
          </div>
        </div>
        <Button className="w-full h-14 text-lg font-bold" disabled={!trip.destination || headerSaving} onClick={startTrip}>
          {headerSaving && <Loader2 className="animate-spin mr-2" />}Start Scanning Receipts
        </Button>
      </Card>
    );
  }

  const pending = cards.filter(c => c.status !== 'approved').length;
  const approved = cards.filter(c => c.status === 'approved').length;

  return (
    <Card className="p-6 max-w-3xl mx-auto space-y-5">
      <div className="flex justify-between items-center border-b pb-4">
        <div className="text-left">
          <p className="text-xs font-bold text-blue-600 uppercase tracking-widest">{trip.userName}</p>
          <p className="text-xl font-bold">{trip.destination}</p>
          <p className="text-xs text-muted-foreground">{approved} saved · {pending} pending</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setStep('details')}>Edit Trip</Button>
      </div>

      <input type="file" ref={fileInputRef} className="hidden" accept="image/*" multiple onChange={handleUpload} />
      <input type="file" ref={cameraRef} className="hidden" accept="image/*" capture="environment" multiple onChange={handleUpload} />

      <div className="grid grid-cols-2 gap-3">
        <Button size="lg" className="h-14 font-bold" onClick={() => fileInputRef.current?.click()}>
          <Plus className="mr-2" />Upload Photos
        </Button>
        <Button size="lg" variant="outline" className="h-14 font-bold" onClick={() => cameraRef.current?.click()}>
          <Camera className="mr-2" />Take Photo
        </Button>
      </div>

      {cards.length === 0 ? (
        <div className="py-16 border-2 border-dashed rounded-2xl text-center text-muted-foreground bg-slate-50/50">
          Upload as many receipts as you want — scanning runs in the background.
        </div>
      ) : (
        <div className="space-y-3">
          {cards.map(c => (
            <ReceiptCardView
              key={c.id}
              card={c}
              onChange={(field, val) => updateField(c.id, field, val)}
              onApprove={() => approveCard(c.id)}
              onDelete={() => deleteCard(c.id)}
              onRetry={() => retryScan(c.id)}
              onEdit={() => updateCard(c.id, { status: 'editing' })}
              onDoneEdit={() => updateCard(c.id, { status: 'ready' })}
            />
          ))}
        </div>
      )}
    </Card>
  );
};

const statusBadge = (s: CardStatus) => {
  const map: Record<CardStatus, [string, string]> = {
    queued:   ['⏳ In queue', 'bg-slate-100 text-slate-700'],
    scanning: ['🔍 Scanning…', 'bg-blue-100 text-blue-700'],
    ready:    ['Ready to review', 'bg-amber-100 text-amber-700'],
    editing:  ['Editing', 'bg-purple-100 text-purple-700'],
    saving:   ['💾 Saving…', 'bg-blue-100 text-blue-700'],
    approved: ['✓ Saved', 'bg-emerald-100 text-emerald-700'],
    error:    ['⚠ Error', 'bg-red-100 text-red-700'],
  };
  const [label, cls] = map[s];
  return <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${cls}`}>{label}</span>;
};

const ReceiptCardView = ({ card, onChange, onApprove, onDelete, onRetry, onEdit, onDoneEdit }: {
  card: ReceiptCard;
  onChange: (field: keyof ReceiptCard, val: string) => void;
  onApprove: () => void; onDelete: () => void; onRetry: () => void; onEdit: () => void; onDoneEdit: () => void;
}) => {
  const editable = card.status === 'editing';
  const locked = card.status === 'saving' || card.status === 'approved';

  return (
    <div className={`border rounded-xl p-3 flex gap-3 transition ${
      card.status === 'approved' ? 'bg-emerald-50/40 border-emerald-200' :
      card.status === 'error' ? 'bg-red-50/40 border-red-200' : 'bg-white'
    }`}>
      <div className="relative w-24 h-32 flex-shrink-0 rounded-lg overflow-hidden border bg-black">
        <img src={card.preview} alt="receipt" className="object-contain w-full h-full" />
        {(card.status === 'scanning' || card.status === 'queued') && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
            {card.status === 'scanning'
              ? <Loader2 className="animate-spin text-white h-6 w-6" />
              : <span className="text-white text-xs font-semibold">In queue</span>}
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-center justify-between gap-2">
          {statusBadge(card.status)}
          <div className="flex gap-1">
            {card.status === 'error' && (
              <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>
            )}
            {(card.status === 'ready' || card.status === 'editing' || card.status === 'error') && (
              <Button size="sm" variant="ghost" onClick={onDelete}><Trash2 className="h-4 w-4" /></Button>
            )}
          </div>
        </div>

        {card.status === 'error' && (
          <p className="text-xs text-red-600">{card.error}</p>
        )}

        {card.status === 'scanning' || card.status === 'queued' ? (
          <p className="text-sm text-muted-foreground">
            {card.status === 'scanning' ? 'AI is reading this receipt…' : 'Waiting for previous scans to finish…'}
          </p>
        ) : (
          <>
            {editable ? (
              <div className="space-y-2">
                <Select value={card.category} onValueChange={(v) => onChange('category', v)}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
                <Input className="h-9" value={card.description} onChange={(e) => onChange('description', e.target.value)} placeholder="Merchant" />
                <div className="grid grid-cols-3 gap-2">
                  <Input type="number" step="0.01" className="h-9" value={card.original_amount}
                    onChange={(e) => onChange('original_amount', e.target.value)} placeholder="Amount" />
                  <Select value={card.original_currency || 'ILS'} onValueChange={(v) => onChange('original_currency', v)}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                  <Input type="number" step="0.01" className="h-9 font-bold bg-blue-50" value={card.amount_ils}
                    onChange={(e) => onChange('amount_ils', e.target.value)} placeholder="₪" />
                </div>
                <Input type="date" className="h-9" value={card.date} onChange={(e) => onChange('date', e.target.value)} />
              </div>
            ) : (
              <div className="text-sm space-y-0.5">
                <p className="font-semibold truncate">{card.description || <span className="text-muted-foreground italic">No description</span>}</p>
                <p className="text-xs text-muted-foreground">{card.category} · {card.date}</p>
                <p className="text-base font-bold text-blue-700">
                  ₪{card.amount_ils || '—'}
                  {card.original_currency && card.original_currency !== 'ILS' && card.original_amount && (
                    <span className="text-xs font-normal text-muted-foreground ml-2">
                      ({card.original_amount} {card.original_currency})
                    </span>
                  )}
                </p>
              </div>
            )}

            {!locked && (
              <div className="flex gap-2 pt-1">
                {editable ? (
                  <Button size="sm" className="flex-1" onClick={onDoneEdit}>Done Editing</Button>
                ) : (
                  <Button size="sm" variant="outline" className="flex-1" onClick={onEdit}>
                    <Edit3 className="mr-1 h-3 w-3" />Edit
                  </Button>
                )}
                <Button size="sm" className="flex-1 bg-emerald-600 hover:bg-emerald-700" onClick={onApprove}
                  disabled={card.status === 'saving' || card.status === 'scanning'}>
                  {card.status === 'saving' ? <Loader2 className="animate-spin h-4 w-4" /> : <><Check className="mr-1 h-3 w-3" />Approve</>}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
