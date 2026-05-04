import React, { useState, useRef } from 'react';
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Upload, Loader2, Check, MapPin, Calendar, Info, ArrowRight, User, Plane, Edit3, LogOut, RefreshCcw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ReceiptScannerProps {
  userEmail: string;
}

export const ReceiptScanner = ({ userEmail }: ReceiptScannerProps) => {
  const [isScanning, setIsScanning] = useState(false);
  const [currentStep, setCurrentStep] = useState<'details' | 'scanner'>('details');
  const [preview, setPreview] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  
  // Trip Metadata
  const [tripData, setTripData] = useState({
    userName: '', 
    destination: '',
    reason: '',
    startDate: new Date().toISOString().split('T')[0],
    returnDate: '',
  });

  // AI/Manual Scan Results
  const [scanResult, setScanResult] = useState({
    amount: '',
    description: '',
    date: new Date().toISOString().split('T')[0],
  });
  
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const GATEWAY_URL = "https://script.google.com/macros/s/AKfycbz_SMHbNDMruPH5pBeIg489faOAc00Kf_o6WEihCtZhxaO5kNHP0gt7bpt8Rh37HmU/exec";

  // RESET APP FOR NEW TRIP
  const handleFinishTrip = () => {
    if (window.confirm("Finish this trip and start a new setup?")) {
      setTripData({
        userName: '', 
        destination: '',
        reason: '',
        startDate: new Date().toISOString().split('T')[0],
        returnDate: '',
      });
      setPreview(null);
      setCurrentStep('details');
      toast({ title: "Trip Reset", description: "Ready for new trip details." });
    }
  };

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

      // AI Logic would be triggered here to populate scanResult
      // For now, we enable manual entry immediately
      setIsScanning(false);
      toast({ title: "Scan Loaded", description: "Please review and edit details below." });
    } catch (error) {
      setIsScanning(false);
      toast({ title: "Scan Failed", variant: "destructive" });
    }
  };

  const handleFinalSave = async () => {
    setIsSaving(true);
    try {
      // Sends all details + ILS instruction to your Google Script
      await fetch(GATEWAY_URL, {
        method: 'POST',
        mode: 'no-cors',
        body: JSON.stringify({
          ...tripData,
          ...scanResult,
          email: userEmail,
          currency: "ILS" 
        }),
      });

      toast({ title: "Saved!", description: "Expense logged in Shekels to your sheet." });
      setPreview(null);
      setScanResult({ amount: '', description: '', date: new Date().toISOString().split('T')[0] });
    } catch (e) {
      toast({ title: "Save Failed", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  // STEP 1: TRIP SETUP (THE STARTING PAGE)
  if (currentStep === 'details') {
    return (
      <Card className="p-8 max-w-xl mx-auto space-y-6 shadow-2xl border-t-8 border-blue-600 animate-in fade-in">
        <div className="flex flex-col items-center gap-2">
          <div className="p-3 bg-blue-100 rounded-full text-blue-600"><Plane className="h-8 w-8" /></div>
          <h2 className="text-2xl font-bold">New Trip Setup</h2>
        </div>
        <div className="space-y-4 text-left">
          <div className="grid gap-2">
            <Label><User className="inline h-4 w-4 mr-2" /> Full Name</Label>
            <Input value={tripData.userName} onChange={(e) => setTripData({...tripData, userName: e.target.value})} placeholder="Jonathan Zvi Shmuely" />
          </div>
          <div className="grid gap-2">
            <Label><MapPin className="inline h-4 w-4 mr-2" /> Destination</Label>
            <Input value={tripData.destination} onChange={(e) => setTripData({...tripData, destination: e.target.value})} placeholder="e.g., South Korea" />
          </div>
          <div className="grid gap-2">
            <Label><Info className="inline h-4 w-4 mr-2" /> Trip Purpose</Label>
            <Input value={tripData.reason} onChange={(e) => setTripData({...tripData, reason: e.target.value})} placeholder="e.g., NPI Factory Audit" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2"><Label>Departure Date</Label><Input type="date" value={tripData.startDate} onChange={(e) => setTripData({...tripData, startDate: e.target.value})} /></div>
            <div className="grid gap-2"><Label>Return Date</Label><Input type="date" value={tripData.returnDate} onChange={(e) => setTripData({...tripData, returnDate: e.target.value})} /></div>
          </div>
        </div>
        <Button className="w-full h-14 text-lg font-bold" disabled={!tripData.destination || !tripData.userName || !tripData.returnDate} onClick={() => setCurrentStep('scanner')}>
          Start Scanning <ArrowRight className="ml-2" />
        </Button>
      </Card>
    );
  }

  // STEP 2: SCANNER & REVIEW
  return (
    <Card className="p-8 max-w-xl mx-auto space-y-6 animate-in slide-in-from-right">
      <div className="flex justify-between items-start border-b pb-4">
        <div className="text-left">
          <p className="text-xs font-black uppercase text-blue-600">{tripData.userName}</p>
          <p className="text-xl font-bold">{tripData.destination}</p>
          <p className="text-xs text-muted-foreground italic">Duration: {tripData.startDate} to {tripData.returnDate}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setCurrentStep('details')}>Edit Trip Info</Button>
      </div>

      {!preview ? (
        <div className="space-y-8">
          <div className="py-20 border-2 border-dashed rounded-2xl flex flex-col items-center bg-slate-50/50">
            <Upload className="h-12 w-12 text-blue-500 mb-4" />
            <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileUpload} />
            <Button size="xl" className="h-16 px-10 font-bold shadow-lg" onClick={() => fileInputRef.current?.click()}>
              Scan New Receipt
            </Button>
          </div>
          
          <Button variant="ghost" className="w-full text-red-500 hover:bg-red-50" onClick={handleFinishTrip}>
            <LogOut className="mr-2 h-4 w-4" /> Finish Entire Trip
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="aspect-[3/4] rounded-xl overflow-hidden border-4 bg-black relative shadow-2xl">
            <img src={preview} alt="Receipt" className="object-contain w-full h-full" />
            {isScanning && <div className="absolute inset-0 bg-black/70 flex items-center justify-center text-white font-bold">AI ANALYZING...</div>}
          </div>

          <div className="space-y-4 text-left border-t pt-4">
            <h4 className="font-bold flex items-center gap-2"><Edit3 className="h-4 w-4 text-blue-600" /> Review & Edit (₪)</h4>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Total in Shekels (₪)</Label>
                <Input type="number" value={scanResult.amount} onChange={(e) => setScanResult({...scanResult, amount: e.target.value})} placeholder="0.00" />
              </div>
              <div className="grid gap-2">
                <Label>Receipt Date</Label>
                <Input type="date" value={scanResult.date} onChange={(e) => setScanResult({...scanResult, date: e.target.value})} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Description</Label>
              <Input value={scanResult.description} onChange={(e) => setScanResult({...scanResult, description: e.target.value})} placeholder="e.g., Factory Lunch" />
            </div>
          </div>

          <div className="flex gap-4">
            <Button variant="outline" className="flex-1" onClick={() => setPreview(null)} disabled={isSaving}><RefreshCcw className="mr-2 h-4 w-4" /> Retake</Button>
            <Button className="flex-[2] bg-emerald-600 h-14 font-bold shadow-xl" onClick={handleFinalSave} disabled={isSaving || isScanning || !scanResult.amount}>
              {isSaving ? <Loader2 className="animate-spin mr-2" /> : <Check className="mr-2" />}
              Confirm & Save to Sheet
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
};