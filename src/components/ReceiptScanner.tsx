import React, { useState, useRef } from 'react';
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Upload, Loader2, Check, MapPin, Calendar, Info, ArrowRight, User, Plane, Edit3, LogOut, Receipt } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Categories pulled directly from your 'droplist' sheet
const CATEGORIES = [
  "טיסות", "נסיעות בתחבורה ציבורית", "לינה ללא ארוחות", 
  "השכרת רכב", "אירוח אורחים בחול", "תקשורת", 
  "ארוחות", "הוצאות שונות", "ללא קבלות"
];

interface ReceiptScannerProps { userEmail: string; }

export const ReceiptScanner = ({ userEmail }: ReceiptScannerProps) => {
  const [isScanning, setIsScanning] = useState(false);
  const [currentStep, setCurrentStep] = useState<'details' | 'scanner'>('details');
  const [preview, setPreview] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  
  const [tripData, setTripData] = useState({
    userName: '', destination: '', reason: '',
    startDate: new Date().toISOString().split('T')[0],
    returnDate: '',
  });

  const [scanResult, setScanResult] = useState({
    amount_ils: '', original_amount: '', original_currency: '',
    description: '', date: new Date().toISOString().split('T')[0],
    category: 'ארוחות'
  });
  
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const GATEWAY_URL = "https://script.google.com/macros/s/AKfycbz_SMHbNDMruPH5pBeIg489faOAc00Kf_o6WEihCtZhxaO5kNHP0gt7bpt8Rh37HmU/exec";

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
        body: JSON.stringify({ image: base64String, action: "scan", target: "ILS" }),
      });

      // AI should return the original currency (e.g., CNY) and the converted ILS
      const data = await response.json();
      if (data) {
        setScanResult({
          amount_ils: data.amount_ils || '',
          original_amount: data.original_amount || '',
          original_currency: data.currency || '',
          description: data.description || '',
          date: data.date || new Date().toISOString().split('T')[0],
          category: data.category || 'ארוחות'
        });
      }
    } catch (e) {
      toast({ title: "AI Scan Offline", description: "Please fill in the shekel amount manually." });
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
        body: JSON.stringify({ ...tripData, ...scanResult, email: userEmail }),
      });
      toast({ title: "Logged to RAW sheet" });
      setPreview(null);
    } catch (e) {
      toast({ title: "Error saving", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  if (currentStep === 'details') {
    return (
      <Card className="p-8 max-w-xl mx-auto space-y-6 shadow-2xl border-t-8 border-blue-600">
        <div className="flex flex-col items-center gap-2">
          <Plane className="h-10 w-10 text-blue-600" />
          <h2 className="text-2xl font-bold">Trip Setup</h2>
        </div>
        <div className="space-y-4 text-left">
          <div className="grid gap-2"><Label>Full Name</Label><Input value={tripData.userName} onChange={(e) => setTripData({...tripData, userName: e.target.value})} placeholder="Jonathan Shmuely" /></div>
          <div className="grid gap-2"><Label>Destination</Label><Input value={tripData.destination} onChange={(e) => setTripData({...tripData, destination: e.target.value})} placeholder="e.g. South Korea" /></div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2"><Label>Departure</Label><Input type="date" value={tripData.startDate} onChange={(e) => setTripData({...tripData, startDate: e.target.value})} /></div>
            <div className="grid gap-2"><Label>Return</Label><Input type="date" value={tripData.returnDate} onChange={(e) => setTripData({...tripData, returnDate: e.target.value})} /></div>
          </div>
        </div>
        <Button className="w-full h-14 text-lg font-bold" disabled={!tripData.destination || !tripData.returnDate} onClick={() => setCurrentStep('scanner')}>Start Scanning <ArrowRight className="ml-2" /></Button>
      </Card>
    );
  }

  return (
    <Card className="p-8 max-w-xl mx-auto space-y-6">
      <div className="flex justify-between items-start border-b pb-4">
        <div className="text-left">
          <p className="text-xs font-black text-blue-600">{tripData.userName}</p>
          <p className="text-xl font-bold">{tripData.destination}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setCurrentStep('details')}>Reset Trip</Button>
      </div>

      {!preview ? (
        <div className="py-20 border-2 border-dashed rounded-2xl flex flex-col items-center bg-slate-50/50">
          <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileUpload} />
          <Button size="xl" className="h-16 px-10 font-bold shadow-xl" onClick={() => fileInputRef.current?.click()}>Scan Receipt</Button>
        </div>
      ) : (
        <div className="space-y-6 animate-in fade-in">
          <div className="aspect-[3/4] rounded-xl overflow-hidden border-4 bg-black relative shadow-lg">
            <img src={preview} alt="Receipt" className="object-contain w-full h-full" />
            {isScanning && <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center text-white font-bold"><Loader2 className="animate-spin h-8 w-8 mb-2" /> AI Converting to Shekels...</div>}
          </div>

          <div className="space-y-4 text-left border-t pt-4">
            <h4 className="font-bold flex items-center gap-2"><Edit3 className="h-4 w-4" /> Verify AI Findings</h4>
            
            <div className="grid gap-2">
              <Label>Category (Checklist)</Label>
              <Select value={scanResult.category} onValueChange={(val) => setScanResult({...scanResult, category: val})}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>{CATEGORIES.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2"><Label>Total in Shekels (₪)</Label><Input type="number" value={scanResult.amount_ils} onChange={(e) => setScanResult({...scanResult, amount_ils: e.target.value})} /></div>
              <div className="grid gap-2"><Label>Original: {scanResult.original_currency}</Label><Input disabled value={scanResult.original_amount} /></div>
            </div>
            
            <div className="grid gap-2"><Label>Description</Label><Input value={scanResult.description} onChange={(e) => setScanResult({...scanResult, description: e.target.value})} /></div>
          </div>

          <div className="flex gap-4">
            <Button variant="outline" className="flex-1" onClick={() => setPreview(null)}>Retake</Button>
            <Button className="flex-[2] bg-emerald-600 h-14 font-bold" onClick={handleFinalSave} disabled={isSaving || isScanning}>
              <Check className="mr-2" /> Confirm & Save to RAW
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
};