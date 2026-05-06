import React, { useState, useRef } from 'react';
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Loader2, Check, Plane, Camera, RefreshCcw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const CATEGORIES = [
  "ארוחות", 
  "טיסות", 
  "נסיעות בתחבורה ציבורית ומוניות", 
  "מלון ולינה", 
  "השכרת רכב", 
  "ביטוח נסיעות וחו״ל", 
  "תקשורת", 
  "הוצאות שונות", 
  "דלק וחניה"
];

export const ReceiptScanner = ({ userEmail }: { userEmail: string }) => {
  const [isScanning, setIsScanning] = useState(false);
  const [currentStep, setCurrentStep] = useState<'details' | 'scanner'>('details');
  const [preview, setPreview] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  
  // Restored your professional profile details
  const [tripData, setTripData] = useState({
    userName: 'Jonny',
    role: 'Industrial Designer',
    destination: '',
    startDate: new Date().toISOString().split('T')[0],
    returnDate: '',
  });

  // Restored all data fields for full tracking
  const [scanResult, setScanResult] = useState({
    amount_ils: '',
    original_amount: '',
    original_currency: '',
    description: '',
    date: new Date().toISOString().split('T')[0],
    category: 'ארוחות'
  });
  
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const GATEWAY_URL = "https://script.google.com/macros/s/AKfycbzuq3ynvlbXvApvhe9B-d9yERuGlzegNBmE6tPOKxtZ430qruZL7QwYZh-F-s9bIas/exec";

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

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

      const response = await fetch(GATEWAY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ image: base64String, action: "analyze", target: "ILS" }),
      });

      const data = await response.json();
      if (data) {
        setScanResult({
          amount_ils: data.amount_ils?.toString() || '',
          original_amount: data.amount_raw?.toString() || '',
          original_currency: data.currency || '',
          description: data.description || '',
          date: data.date || new Date().toISOString().split('T')[0],
          category: data.category || 'ארוחות'
        });
      }
    } catch (e) {
      toast({ title: "AI Sync Issue", description: "Manual entry ready.", variant: "destructive" });
    } finally {
      setIsScanning(false);
    }
  };

  const handleFinalSave = async () => {
    setIsSaving(true);
    try {
      await fetch(GATEWAY_URL, {
        method: 'POST',
        mode: 'no-cors', 
        body: JSON.stringify({
          action: "saveExpense",
          date: scanResult.date,
          category: scanResult.category,
          amount_ils: scanResult.amount_ils,
          original_amount: scanResult.original_amount,
          original_currency: scanResult.original_currency,
          description: scanResult.description,
          destination: tripData.destination,
          email: userEmail
        }),
      });
      // Clear for the next receipt
      setPreview(null);
      setScanResult({
        amount_ils: '',
        original_amount: '',
        original_currency: '',
        description: '',
        date: new Date().toISOString().split('T')[0],
        category: 'ארוחות'
      });
      toast({ title: "Saved Successfully" });
    } finally {
      setIsSaving(false);
    }
  };

  // UI STEP 1: Trip Setup
  if (currentStep === 'details') {
    return (
      <Card className="p-8 max-w-xl mx-auto space-y-6">
        <div className="flex items-center gap-3 border-b pb-4">
          <Plane className="h-6 w-6 text-blue-600" />
          <div>
            <h2 className="text-xl font-bold">Trip Setup</h2>
            <p className="text-sm text-gray-500">{tripData.userName} | {tripData.role}</p>
          </div>
        </div>
        <div className="space-y-4">
          <div>
            <Label>Destination</Label>
            <Input placeholder="e.g. Guangzhou" value={tripData.destination} onChange={(e) => setTripData({...tripData, destination: e.target.value})} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Start Date</Label>
              <Input type="date" value={tripData.startDate} onChange={(e) => setTripData({...tripData, startDate: e.target.value})} />
            </div>
            <div>
              <Label>Return Date</Label>
              <Input type="date" value={tripData.returnDate} onChange={(e) => setTripData({...tripData, returnDate: e.target.value})} />
            </div>
          </div>
          <Button className="w-full h-12 text-lg" disabled={!tripData.destination} onClick={() => setCurrentStep('scanner')}>
            Start Scanning Receipts
          </Button>
        </div>
      </Card>
    );
  }

  // UI STEP 2: Scanner
  return (
    <Card className="p-8 max-w-xl mx-auto space-y-6">
      <div className="flex justify-between items-center border-b pb-4">
        <div>
          <p className="text-xs font-bold text-blue-600 uppercase tracking-wider">{tripData.destination}</p>
          <p className="text-lg font-semibold">{tripData.startDate} — {tripData.returnDate}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => { localStorage.clear(); window.location.reload(); }}>
          <RefreshCcw className="h-4 w-4 mr-2" /> Reset
        </Button>
      </div>

      {!preview ? (
        <div className="py-20 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center bg-slate-50/50">
          <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileUpload} />
          <Button size="lg" className="h-16 px-10 gap-2 shadow-lg" onClick={() => fileInputRef.current?.click()}>
            <Camera className="h-6 w-6" /> Upload Receipt
          </Button>
          <p className="mt-4 text-sm text-slate-400">Ready for your next expense</p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="relative aspect-[4/3] bg-black rounded-xl overflow-hidden border-2 shadow-inner">
            <img src={preview} className="object-contain w-full h-full" />
            {isScanning && (
              <div className="absolute inset-0 bg-black/75 flex flex-col items-center justify-center text-white">
                <Loader2 className="animate-spin h-10 w-10 mb-2" />
                <p className="font-bold tracking-widest text-sm">AI IS CALCULATING...</p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4 text-left">
            <div className="col-span-2">
              <Label>Description</Label>
              <Input value={scanResult.description} onChange={(e) => setScanResult({...scanResult, description: e.target.value})} />
            </div>
            <div>
              <Label>Category</Label>
              <Select value={scanResult.category} onValueChange={(val) => setScanResult({...scanResult, category: val})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Date</Label>
              <Input type="date" value={scanResult.date} onChange={(e) => setScanResult({...scanResult, date: e.target.value})} />
            </div>
            <div>
              <Label>Original Amount</Label>
              <div className="flex gap-2">
                <Input className="w-16 px-2 text-center" placeholder="CNY" value={scanResult.original_currency} onChange={(e) => setScanResult({...scanResult, original_currency: e.target.value})} />
                <Input type="number" placeholder="0.00" value={scanResult.original_amount} onChange={(e) => setScanResult({...scanResult, original_amount: e.target.value})} />
              </div>
            </div>
            <div>
              <Label className="text-blue-600 font-bold">Total (₪)</Label>
              <Input className="border-blue-400 border-2 font-bold bg-blue-50/30" type="number" value={scanResult.amount_ils} onChange={(e) => setScanResult({...scanResult, amount_ils: e.target.value})} />
            </div>
          </div>

          <div className="flex gap-4 pt-2">
            <Button variant="outline" className="flex-1" onClick={() => setPreview(null)}>Discard</Button>
            <Button className="flex-[2] bg-emerald-600 hover:bg-emerald-700 shadow-md" onClick={handleFinalSave} disabled={isSaving || isScanning}>
              {isSaving ? <Loader2 className="animate-spin mr-2" /> : <Check className="mr-2 h-5 w-5" />} Save to Spreadsheet
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
};