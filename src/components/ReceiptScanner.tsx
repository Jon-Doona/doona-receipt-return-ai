import React, { useState, useRef } from 'react';
import { useToast } from "@/components/ui/use-toast";
import { scanReceipt, saveExpense } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Loader2, Check, Plane, Camera, RefreshCcw, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const CATEGORIES = ["ארוחות", "טיסות", "נסיעות בתחבורה ציבורית ומוניות", "מלון ולינה", "השכרת רכב", "ביטוח נסיעות וחו״ל", "תקשורת", "הוצאות שונות", "דלק וחניה"];

// Exchange rates to ILS
const EXCHANGE_RATES: Record<string, number> = {
  'RMB': 0.45,
  'USD': 3.44,
  'EUR': 3.82,
  'ILS': 1.00
};

interface ReceiptItem {
  id: string;
  file: File;
  preview: string;
  status: 'pending' | 'scanning' | 'done' | 'error';
  errorMsg?: string;
  data: {
    date: string;
    category: string;
    amount: number;  // ILS amount
    currency: string;  // Original currency
    description: string;
    original_amount?: number;
    reason: string;
  };
  savedToSheet: boolean;
}

export const ReceiptScanner = ({ userEmail }: { userEmail: string }) => {
  const [currentStep, setCurrentStep] = useState<'details' | 'scanner'>('details');
  const [receipts, setReceipts] = useState<ReceiptItem[]>([]);
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  
  const [tripData, setTripData] = useState({
    userName: 'Jonny',
    role: 'Industrial Designer',
    destination: '',
    reason: '',
    startDate: new Date().toISOString().split('T')[0],
    returnDate: '',
  });

  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ===== HELPERS =====
  const log = (step: string, message: string, data?: any) => {
    console.log(`[${step}]: ${message}`, data || '');
  };

  const calculateILSAmount = (originalAmount: number, currency: string): number => {
    if (originalAmount <= 0 || !currency) return 0;
    const rate = EXCHANGE_RATES[currency] || 1;
    return Math.round(originalAmount * rate * 100) / 100;
  };

  // ===== MAIN SCANNING LOGIC =====
  const scanReceiptFile = async (receiptItem: ReceiptItem): Promise<void> => {
    const receiptId = receiptItem.id;
    try {
      setReceipts(prev => prev.map(r => r.id === receiptId ? { ...r, status: 'scanning' } : r));

      const base64Full = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(receiptItem.file);
      });

      const mimeType = receiptItem.file.type || 'image/jpeg';
      const aiData = await scanReceipt(base64Full, mimeType);

      setReceipts(prev =>
        prev.map(r => {
          if (r.id !== receiptId) return r;
          const currency = aiData.currency === 'CNY' ? 'RMB' : (aiData.currency || 'USD');
          const originalAmount = parseFloat(aiData.amount) || 0;
          
          return {
            ...r,
            status: 'done',
            data: {
              date: aiData.date || new Date().toISOString().split('T')[0],
              category: aiData.category || 'ארוחות',
              amount: calculateILSAmount(originalAmount, currency),
              currency: currency,
              description: aiData.description || '',
              original_amount: originalAmount,
              reason: r.data.reason,
            }
          };
        })
      );

      toast({ title: "✅ Scan Success", description: "Data extracted from receipt." });
    } catch (error) {
      setReceipts(prev => prev.map(r => r.id === receiptId ? { ...r, status: 'error', errorMsg: "Scan failed" } : r));
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    for (const file of files) {
      const receiptId = Math.random().toString(36).substr(2, 9);
      const preview = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });

      const newReceipt: ReceiptItem = {
        id: receiptId,
        file,
        preview,
        status: 'pending',
        data: {
          date: new Date().toISOString().split('T')[0],
          category: 'ארוחות',
          amount: 0,
          currency: 'USD',
          description: '',
          original_amount: 0,
          reason: tripData.reason,
        },
        savedToSheet: false
      };

      setReceipts(prev => [...prev, newReceipt]);
      scanReceiptFile(newReceipt);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const saveReceiptToSheet = async (receiptId: string) => {
    const receipt = receipts.find(r => r.id === receiptId);
    if (!receipt) return;

    setSavingIds(prev => new Set([...prev, receiptId]));
    try {
      await saveExpense({
        ...receipt.data,
        destination: tripData.destination,
        reason: receipt.data.reason || tripData.reason,
        employee: tripData.userName
      });
      setReceipts(prev => prev.map(r => r.id === receiptId ? { ...r, savedToSheet: true } : r));
      toast({ title: "✅ Saved", description: "Expense added to sheet." });
    } catch (error) {
      toast({ title: "❌ Error", description: "Failed to save to sheet.", variant: "destructive" });
    } finally {
      setSavingIds(prev => {
        const next = new Set(prev);
        next.delete(receiptId);
        return next;
      });
    }
  };

  const updateReceiptField = (receiptId: string, field: string, value: any) => {
    setReceipts(prev => prev.map(r => {
      if (r.id !== receiptId) return r;
      const updated = { ...r, data: { ...r.data, [field]: value } };
      if (field === 'original_amount' || field === 'currency') {
        updated.data.amount = calculateILSAmount(
            field === 'original_amount' ? value : r.data.original_amount!,
            field === 'currency' ? value : r.data.currency
        );
      }
      return updated;
    }));
  };

  if (currentStep === 'details') {
    return (
      <Card className="p-8 max-w-xl mx-auto space-y-6 text-left">
        <div className="flex items-center gap-3 border-b pb-4">
          <Plane className="h-6 w-6 text-blue-600" />
          <h2 className="text-xl font-bold">Trip Setup</h2>
        </div>
        <div className="space-y-4">
          <Label>Destination</Label>
          <Input placeholder="China" value={tripData.destination} onChange={(e) => setTripData({...tripData, destination: e.target.value})} />
          <Label>Trip Reason</Label>
          <Input
            placeholder="Factory Visit"
            value={tripData.reason}
            onChange={(e) => setTripData({ ...tripData, reason: e.target.value })}
          />
          <Button
            className="w-full"
            disabled={!tripData.destination || !tripData.reason.trim()}
            onClick={() => setCurrentStep('scanner')}
          >
            Next
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-6 text-left">
      <Card className="p-6 flex justify-between items-center">
        <div>
          <h3 className="font-bold text-lg">{tripData.destination} Trip</h3>
          <p className="text-xs text-muted-foreground">{tripData.reason}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => window.location.reload()}>Reset</Button>
      </Card>

      <Card className="p-10 border-2 border-dashed flex flex-col items-center">
        <input type="file" ref={fileInputRef} className="hidden" accept="image/*" multiple onChange={handleFileUpload} />
        <Button size="lg" onClick={() => fileInputRef.current?.click()}><Camera className="mr-2" /> Upload Receipts</Button>
      </Card>

      <div className="grid gap-6">
        {receipts.map(receipt => (
          <Card key={receipt.id} className="p-6 space-y-4">
            <div className="flex justify-between">
              <p className="text-sm font-mono">{receipt.file.name}</p>
              {receipt.savedToSheet && <span className="text-emerald-600 text-xs font-bold">SAVED ✅</span>}
            </div>
            
            <div className="aspect-video bg-slate-100 rounded overflow-hidden">
                <img src={receipt.preview} className="w-full h-full object-contain" />
            </div>

            {(receipt.status === 'done' || receipt.status === 'error') && (
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                    <Label>Description</Label>
                    <Input value={receipt.data.description} onChange={e => updateReceiptField(receipt.id, 'description', e.target.value)} />
                </div>
                <div className="col-span-2">
                    <Label>Trip Reason</Label>
                    <Input
                      value={receipt.data.reason}
                      onChange={e => updateReceiptField(receipt.id, 'reason', e.target.value)}
                      placeholder="Factory Visit"
                    />
                </div>
                <div>
                  <Label>Date</Label>
                  <Input type="date" value={receipt.data.date} onChange={e => updateReceiptField(receipt.id, 'date', e.target.value)} />
                </div>
                <div>
                  <Label>Category</Label>
                  <Select value={receipt.data.category} onValueChange={v => updateReceiptField(receipt.id, 'category', v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Amount ({receipt.data.currency})</Label>
                  <Input type="number" value={receipt.data.original_amount} onChange={e => updateReceiptField(receipt.id, 'original_amount', parseFloat(e.target.value))} />
                </div>
                <div>
                  <Label>Total (₪)</Label>
                  <Input className="bg-blue-50 font-bold" value={receipt.data.amount} readOnly />
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setReceipts(r => r.filter(x => x.id !== receipt.id))}><Trash2 className="h-4 w-4" /></Button>
              {!receipt.savedToSheet && receipt.status === 'done' && (
                <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => saveReceiptToSheet(receipt.id)} disabled={savingIds.has(receipt.id)}>
                   {savingIds.has(receipt.id) ? <Loader2 className="animate-spin" /> : "Save to Sheet"}
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
};