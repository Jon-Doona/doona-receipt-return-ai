import React, { useState, useRef } from 'react';
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Loader2, Check, Plane, Edit3, RefreshCcw, LayoutGrid } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// These match the 'droplist' sheet in your Excel file
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

interface ReceiptScannerProps {
  userEmail: string;
}

export const ReceiptScanner = ({ userEmail }: ReceiptScannerProps) => {
  const [isScanning, setIsScanning] = useState(false);
  const [currentStep, setCurrentStep] = useState<'details' | 'scanner'>('details');
  const [preview, setPreview] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  
  // Trip Setup State
  const [tripData, setTripData] = useState({
    userName: 'Jonathan Zvi Shmuely', // Your name from the system
    destination: '',
    startDate: new Date().toISOString().split('T')[0],
    returnDate: '',
  });

  // This is the "Review & Edit" state that the AI will fill
  const [scanResult, setScanResult] = useState({
    amount_ils: '',        // Total in Shekels
    original_amount: '',   // The number from the pic (e.g. 8.00)
    original_currency: '', // e.g. CNY, USD
    description: '',
    date: new Date().toISOString().split('T')[0],
    category: 'ארוחות'     // Default checklist item
  });
  
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Replace this with your actual Google Script URL
  const GATEWAY_URL = "https://script.google.com/macros/s/AKfycbz_SMHbNDMruPH5pBeIg489faOAc00Kf_o6WEihCtZhxaO5kNHP0gt7bpt8Rh37HmU/exec";

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Show preview immediately so you know it's working
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

      // Sending to Google Script for AI analysis
      const response = await fetch(GATEWAY_URL, {
        method: 'POST',
        body: JSON.stringify({ 
          image: base64String, 
          action: "analyze",
          target: "ILS" 
        }),
      });

      const data = await response.json();

      // THIS FILLS THE BOXES AUTOMATICALLY
      if (data) {
        setScanResult({
          amount_ils: data.amount_ils?.toString() || '',
          original_amount: data.amount_raw?.toString() || '',
          original_currency: data.currency || '',
          description: data.description || '',
          date: data.date || new Date().toISOString().split('T')[0],
          category: data.category || 'ארוחות'
        });
        toast({ title: "AI Scan Success", description: "Shekel conversion applied." });
      }
    } catch (error) {
      console.error(error);
      toast({ title: "AI Busy", description: "Please enter the shekel amount manually.", variant: "destructive" });
    } finally {
      setIsScanning(false);
    }
  };

  const handleFinalSave = async () => {
    setIsSaving(true);
    try {
      // Sends data to the 'RAW' sheet in your Excel
      await fetch(GATEWAY_URL, {
        method: 'POST',
        mode: 'no-cors', // standard for Google Script POST
        body: JSON.stringify({
          ...tripData,
          ...scanResult,
          email: userEmail,
        }),
      });
      toast({ title: "Success", description: "Expense added to RAW sheet." });
      setPreview(null);
      setScanResult(prev => ({ ...prev, amount_ils: '', description: '' }));
    } catch (e) {
      toast({ title: "Error", description: "Could not save to sheet.", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  // STEP 1: TRIP INFO
  if (currentStep === 'details') {
    return (
      <Card className="p-8 max-w-xl mx-auto space-y-6 shadow-2xl border-t-8 border-blue-600">
        <div className="flex flex-col items-center gap-2">
          <Plane className="h-10 w-10 text-blue-600" />
          <h2 className="text-2xl font-bold">Trip Setup</h2>
        </div>
        <div className="space-y-4 text-left">
          <div className="grid gap-2"><Label>Full Name</Label><Input value={tripData.userName} onChange={(e) => setTripData({...tripData, userName: e.target.value})} /></div>
          <div className="grid gap-2"><Label>Destination</Label><Input value={tripData.destination} onChange={(e) => setTripData({...tripData, destination: e.target.value})} placeholder="City/Country" /></div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2"><Label>Departure</Label><Input type="date" value={tripData.startDate} onChange={(e) => setTripData({...tripData, startDate: e.target.value})} /></div>
            <div className="grid gap-2"><Label>Return</Label><Input type="date" value={tripData.returnDate} onChange={(e) => setTripData({...tripData, returnDate: e.target.value})} /></div>
          </div>
        </div>
        <Button className="w-full h-14 text-lg font-bold" disabled={!tripData.destination} onClick={() => setCurrentStep('scanner')}>Start Scanning Receipts</Button>
      </Card>
    );
  }

  // STEP 2: SCANNER & REVIEW
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
          <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileUpload} />
          <Button size="xl" className="h-16 px-10 font-bold" onClick={() => fileInputRef.current?.click()}>Take Photo</Button>
        </div>
      ) : (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
          <div className="aspect-[3/4] rounded-xl overflow-hidden border-4 bg-black relative shadow-lg">
            <img src={preview} alt="Receipt" className="object-contain w-full h-full" />
            {isScanning && (
              <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center text-white font-bold">
                <Loader2 className="animate-spin h-8 w-8 mb-2 text-blue-400" />
                AI IS CALCULATING SHEKELS...
              </div>
            )}
          </div>

          <div className="space-y-4 text-left border-t pt-4">
            <h4 className="font-bold flex items-center gap-2"><Edit3 className="h-4 w-4 text-blue-600" /> Review & Edit</h4>
            
            <div className="grid gap-2">
              <Label className="flex items-center gap-1 text-slate-500"><LayoutGrid className="h-3 w-3" /> Category (Checklist)</Label>
              <Select value={scanResult.category} onValueChange={(val) => setScanResult({...scanResult, category: val})}>
                <SelectTrigger className="h-12 text-lg"><SelectValue placeholder="Pick category" /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Total in Shekels (₪)</Label>
                <Input className="h-12 text-lg font-bold border-blue-200 bg-blue-50/50" type="number" value={scanResult.amount_ils} onChange={(e) => setScanResult({...scanResult, amount_ils: e.target.value})} />
              </div>
              <div className="grid gap-2">
                <Label className="text-slate-400">Original Amount</Label>
                <div className="h-12 flex items-center px-3 rounded-md border bg-slate-50 text-slate-500 italic">
                  {scanResult.original_amount} {scanResult.original_currency}
                </div>
              </div>
            </div>

            <div className="grid gap-2"><Label>Description</Label><Input className="h-12" value={scanResult.description} onChange={(e) => setScanResult({...scanResult, description: e.target.value})} /></div>
          </div>

          <div className="flex gap-4">
            <Button variant="outline" className="flex-1 h-14" onClick={() => setPreview(null)}><RefreshCcw className="mr-2 h-4 w-4" /> Retake</Button>
            <Button className="flex-[2] bg-emerald-600 h-14 font-bold text-lg hover:bg-emerald-700" onClick={handleFinalSave} disabled={isSaving || isScanning}>
              {isSaving ? <Loader2 className="animate-spin mr-2" /> : <Check className="mr-2" />} Save to RAW Sheet
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
};