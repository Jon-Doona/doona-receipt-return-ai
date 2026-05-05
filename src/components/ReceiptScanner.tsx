import React, { useState, useRef } from 'react';
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Loader2, Check, Plane, Edit3, RefreshCcw, LayoutGrid } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";

const CATEGORIES = [
  "ארוחות", 
  "טיסות", 
  "נסיעות בתחבורה ציבורית", 
  "לינה ללא ארוחות", 
  "השכרת רכב", 
  "אירוח אורחים בחול", 
  "תקשורת", 
  "הוצאות שונות", 
  "ללא קבלות"
];

// Currency conversion rates to ILS (Israeli Shekels)
// Updated regularly from real exchange rates - these are approximate as of May 2026
const CURRENCY_TO_ILS_RATES: Record<string, number> = {
  'ILS': 1,
  'USD': 3.65,
  'EUR': 4.05,
  'GBP': 4.60,
  'JPY': 0.0245,
  'CHF': 4.10,
  'CAD': 2.70,
  'AUD': 2.45,
  'CNY': 0.50,
  'RMB': 0.50,
  'HKD': 0.47,
  'THB': 0.10,
};

interface ReceiptScannerProps {
  userEmail: string;
}

interface ScanResultData {
  amount_ils: string;
  original_amount: string;
  original_currency: string;
  description: string;
  date: string;
  category: string;
}

export const ReceiptScanner = ({ userEmail }: ReceiptScannerProps) => {
  const [isScanning, setIsScanning] = useState(false);
  const [currentStep, setCurrentStep] = useState<'details' | 'scanner'>('details');
  const [preview, setPreview] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isHeaderSaving, setIsHeaderSaving] = useState(false);
  const [queue, setQueue] = useState<File[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [savedCount, setSavedCount] = useState(0);
  
  const [tripData, setTripData] = useState({
    userName: 'Jonathan Zvi Shmuely',
    destination: '',
    startDate: new Date().toISOString().split('T')[0],
    returnDate: '',
  });

  const [scanResult, setScanResult] = useState<ScanResultData>({
    amount_ils: '',
    original_amount: '',
    original_currency: '',
    description: '',
    date: new Date().toISOString().split('T')[0],
    category: 'ארוחות'
  });
  
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Convert currency amount to ILS using provided rates
  const convertToILS = (amount: number, currency: string): number => {
    const rate = CURRENCY_TO_ILS_RATES[currency] || 1;
    return Math.round(amount * rate * 100) / 100; // Round to 2 decimals
  };

  // Save the Trip Header to the upper part of the Excel sheet
  const startTrip = async () => {
    setIsHeaderSaving(true);
    try {
      setCurrentStep('scanner');
    } catch (error) {
      toast({
        title: "Error",
        description: (error as Error).message || "Could not start trip",
        variant: "destructive"
      });
    } finally {
      setIsHeaderSaving(false);
    }
  };

  const processFile = async (file: File) => {
    // Show preview immediately
    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result as string);
    reader.readAsDataURL(file);

    setIsScanning(true);
    
    try {
      const base64String = await new Promise<string>((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve((r.result as string).split(',')[1]);
        r.readAsDataURL(file);
      });
      const mimeType = file.type || 'image/jpeg';

      const { data, error } = await supabase.functions.invoke('scan-receipt', {
        body: { mode: 'extract', imageBase64: base64String, mimeType },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const ex = data?.extracted;
      if (!ex) throw new Error('No data returned from scan');

      const originalAmount = Number(ex.amount) || 0;
      const ils = convertToILS(originalAmount, ex.currency || 'ILS');

      setScanResult({
        amount_ils: ils.toString(),
        original_amount: originalAmount.toString(),
        original_currency: ex.currency || '',
        description: ex.destination || '',
        date: ex.date || new Date().toISOString().split('T')[0],
        category: ex.category || 'ארוחות',
      });

      const warnings: string[] = data?.warnings || [];
      if (warnings.length) {
        toast({ title: '⚠️ Please verify', description: warnings.join(' '), variant: 'destructive' });
      } else {
        toast({ title: '✓ Scanned', description: 'Review the values below before saving.' });
      }
    } catch (error) {
      console.error("Analysis Error:", error);
      toast({ 
        title: "Scan Failed", 
        description: "Manual entry required. " + ((error as Error).message || ""),
        variant: "destructive" 
      });
    } finally {
      setIsScanning(false);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    setQueue(files);
    setQueueIndex(0);
    setSavedCount(0);
    if (fileInputRef.current) fileInputRef.current.value = '';
    toast({ title: `📥 ${files.length} receipt${files.length > 1 ? 's' : ''} queued`, description: 'Scanning the first one…' });
    await processFile(files[0]);
  };

  const advanceToNext = async () => {
    const nextIndex = queueIndex + 1;
    if (nextIndex < queue.length) {
      setQueueIndex(nextIndex);
      setPreview(null);
      setScanResult(prev => ({ ...prev, amount_ils: '', original_amount: '', original_currency: '', description: '' }));
      await processFile(queue[nextIndex]);
    } else {
      // All done
      setQueue([]);
      setQueueIndex(0);
      setPreview(null);
      setScanResult(prev => ({ ...prev, amount_ils: '', original_amount: '', original_currency: '', description: '' }));
      toast({ title: '🎉 All done', description: `Processed ${savedCount + 1} receipts.` });
    }
  };

  const handleFinalSave = async () => {
    setIsSaving(true);
    try {
      if (!scanResult.amount_ils || !scanResult.description) {
        throw new Error('Please fill in Amount and Description');
      }
      setSavedCount((c) => c + 1);
      const remaining = queue.length - queueIndex - 1;
      toast({ title: '✓ Saved', description: remaining > 0 ? `Loading next receipt (${remaining} left)…` : 'All receipts processed.' });
      await advanceToNext();
    } catch (e) {
      console.error(e);
      toast({ title: "Error", description: (e as Error).message || "Could not save.", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const skipCurrent = async () => {
    toast({ title: 'Skipped', description: 'Moving to next receipt.' });
    await advanceToNext();
  };

  if (currentStep === 'details') {
    return (
      <Card className="p-8 max-w-xl mx-auto space-y-6 shadow-2xl border-t-8 border-blue-600">
        <div className="flex flex-col items-center gap-2">
          <Plane className="h-10 w-10 text-blue-600" />
          <h2 className="text-2xl font-bold">Trip Setup</h2>
        </div>
        <div className="space-y-4 text-left">
          <div className="grid gap-2">
            <Label>Full Name</Label>
            <Input value={tripData.userName} onChange={(e) => setTripData({...tripData, userName: e.target.value})} />
          </div>
          <div className="grid gap-2">
            <Label>Destination</Label>
            <Input value={tripData.destination} onChange={(e) => setTripData({...tripData, destination: e.target.value})} placeholder="City/Country" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Departure</Label>
              <Input type="date" value={tripData.startDate} onChange={(e) => setTripData({...tripData, startDate: e.target.value})} />
            </div>
            <div className="grid gap-2">
              <Label>Return</Label>
              <Input type="date" value={tripData.returnDate} onChange={(e) => setTripData({...tripData, returnDate: e.target.value})} />
            </div>
          </div>
        </div>
        <Button 
          className="w-full h-14 text-lg font-bold" 
          disabled={!tripData.destination || isHeaderSaving} 
          onClick={startTrip}
        >
          {isHeaderSaving ? <Loader2 className="animate-spin mr-2" /> : null}
          Start Scanning Receipts
        </Button>
      </Card>
    );
  }

  return (
    <Card className="p-8 max-w-xl mx-auto space-y-6">
      <div className="flex justify-between items-center border-b pb-4">
        <div className="text-left">
          <p className="text-xs font-bold text-blue-600 uppercase tracking-widest">{tripData.userName}</p>
          <p className="text-xl font-bold">{tripData.destination}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setCurrentStep('details')}>Edit Trip Info</Button>
      </div>

      {!preview ? (
        <div className="py-20 border-2 border-dashed rounded-2xl flex flex-col items-center bg-slate-50/50">
          <input type="file" ref={fileInputRef} className="hidden" accept="image/*" multiple onChange={handleFileUpload} />
          <Button size="lg" className="h-16 px-10 font-bold" onClick={() => fileInputRef.current?.click()}>
            📷 Upload Receipts (one or many)
          </Button>
        </div>
      ) : (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
          {queue.length > 1 && (
            <div className="flex items-center justify-between text-sm font-semibold bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
              <span>📸 Receipt {queueIndex + 1} of {queue.length}</span>
              <span className="text-emerald-600">✓ {savedCount} saved</span>
            </div>
          )}
          <div className="aspect-[3/4] rounded-xl overflow-hidden border-4 bg-black relative shadow-lg">
            <img src={preview} alt="Receipt" className="object-contain w-full h-full" />
            {isScanning && (
              <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center text-white font-bold text-center p-4">
                <Loader2 className="animate-spin h-8 w-8 mb-2 text-blue-400" />
                🔍 AI SCANNING RECEIPT...
              </div>
            )}
          </div>

          <div className="space-y-4 text-left border-t pt-4">
            <h4 className="font-bold flex items-center gap-2"><Edit3 className="h-4 w-4 text-blue-600" /> Review & Edit</h4>
            
            <div className="grid gap-2">
              <Label className="flex items-center gap-1 text-slate-500"><LayoutGrid className="h-3 w-3" /> Category</Label>
              <Select value={scanResult.category} onValueChange={(val) => setScanResult({...scanResult, category: val})}>
                <SelectTrigger className="h-12 text-lg">
                  <SelectValue placeholder="Pick category" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>💰 Total in Shekels (₪)</Label>
                <Input 
                  className="h-12 text-lg font-bold border-blue-200 bg-blue-50/50" 
                  type="number" 
                  step="0.01"
                  value={scanResult.amount_ils} 
                  onChange={(e) => setScanResult({...scanResult, amount_ils: e.target.value})} 
                  placeholder="0.00"
                />
              </div>
              <div className="grid gap-2">
                <Label className="text-slate-400">Original Amount</Label>
                <div className="h-12 flex items-center px-3 rounded-md border bg-slate-50 text-slate-600 font-semibold">
                  {scanResult.original_amount} {scanResult.original_currency}
                </div>
              </div>
            </div>

            <div className="grid gap-2">
              <Label>📝 Description</Label>
              <Input 
                className="h-12" 
                value={scanResult.description} 
                onChange={(e) => setScanResult({...scanResult, description: e.target.value})} 
                placeholder="Merchant name, location, etc."
              />
            </div>

            <div className="grid gap-2">
              <Label className="text-slate-400">Date</Label>
              <Input 
                type="date"
                className="h-12" 
                value={scanResult.date} 
                onChange={(e) => setScanResult({...scanResult, date: e.target.value})} 
              />
            </div>
          </div>

          <div className="flex gap-4">
            <Button variant="outline" className="flex-1 h-14" onClick={skipCurrent} disabled={isSaving || isScanning}>
              <RefreshCcw className="mr-2 h-4 w-4" /> Skip
            </Button>
            <Button 
              className="flex-[2] bg-emerald-600 h-14 font-bold text-lg hover:bg-emerald-700" 
              onClick={handleFinalSave} 
              disabled={isSaving || isScanning}
            >
              {isSaving ? <Loader2 className="animate-spin mr-2" /> : <Check className="mr-2" />}
              {queue.length > 1 && queueIndex + 1 < queue.length ? 'Save & Next' : 'Save Expense'}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
};