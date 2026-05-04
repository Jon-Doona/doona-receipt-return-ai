import React, { useState, useRef } from 'react';
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Upload, Loader2, Check, MapPin, Calendar, Info, ArrowRight, User } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ReceiptScannerProps {
  userEmail: string;
}

export const ReceiptScanner = ({ userEmail }: ReceiptScannerProps) => {
  const [isScanning, setIsScanning] = useState(false);
  // We force 'details' as the starting step
  const [step, setStep] = useState<'details' | 'scan'>('details');
  const [preview, setPreview] = useState<string | null>(null);
  
  const [tripData, setTripData] = useState({
    userName: '', // Added name field
    destination: '',
    reason: '',
    date: new Date().toISOString().split('T')[0],
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

      // Send all data including trip details and the ILS requirement
      await fetch(GATEWAY_URL, {
        method: 'POST',
        mode: 'no-cors', 
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          image: base64String,
          email: userEmail,
          userName: tripData.userName,
          destination: tripData.destination,
          reason: tripData.reason,
          date: tripData.date,
          currency: "ILS" // Always calculate in shekels
        }),
      });

      toast({ title: "Success", description: "Expense logged in Shekels (ILS)." });
    } catch (error) {
      toast({ title: "Upload Failed", variant: "destructive" });
    } finally {
      setIsScanning(false);
    }
  };

  // STEP 1: TRIP DETAILS (The starting screen)
  if (step === 'details') {
    return (
      <Card className="p-8 max-w-xl mx-auto space-y-6 shadow-xl border-t-4 border-blue-600 animate-in fade-in duration-500">
        <div className="text-center space-y-2">
          <h3 className="text-2xl font-bold">New Trip Setup</h3>
          <p className="text-muted-foreground text-sm">Enter details before scanning receipts</p>
        </div>

        <div className="space-y-4 text-left">
          <div className="grid gap-2">
            <Label className="flex items-center gap-2"><User className="h-4 w-4" /> Full Name</Label>
            <Input 
              value={tripData.userName} 
              onChange={(e) => setTripData({...tripData, userName: e.target.value})} 
              placeholder="Jonathan Shmuely"
            />
          </div>
          <div className="grid gap-2">
            <Label className="flex items-center gap-2"><MapPin className="h-4 w-4" /> Destination Country</Label>
            <Input 
              value={tripData.destination} 
              onChange={(e) => setTripData({...tripData, destination: e.target.value})} 
              placeholder="e.g. South Korea"
            />
          </div>
          <div className="grid gap-2">
            <Label className="flex items-center gap-2"><Info className="h-4 w-4" /> Trip Purpose</Label>
            <Input 
              value={tripData.reason} 
              onChange={(e) => setTripData({...tripData, reason: e.target.value})} 
              placeholder="e.g. NPI Quality Control"
            />
          </div>
          <div className="grid gap-2">
            <Label className="flex items-center gap-2"><Calendar className="h-4 w-4" /> Start Date</Label>
            <Input 
              type="date" value={tripData.date} 
              onChange={(e) => setTripData({...tripData, date: e.target.value})}
            />
          </div>
        </div>

        <Button 
          className="w-full h-14 text-lg font-bold bg-blue-600 hover:bg-blue-700" 
          disabled={!tripData.destination || !tripData.userName}
          onClick={() => setStep('scan')}
        >
          Next: Scan Expenses <ArrowRight className="ml-2 h-5 w-5" />
        </Button>
      </Card>
    );
  }

  // STEP 2: SCANNER (Only shows after Details are filled)
  return (
    <Card className="p-8 max-w-xl mx-auto space-y-6 animate-in slide-in-from-right duration-300">
      <div className="flex justify-between items-center border-b pb-4">
        <div className="text-left">
          <p className="text-xs font-bold uppercase text-blue-600">{tripData.userName}</p>
          <p className="text-lg font-semibold">{tripData.destination}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setStep('details')}>Change Trip</Button>
      </div>

      {!preview ? (
        <div className="py-20 border-2 border-dashed rounded-xl flex flex-col items-center bg-slate-50/50">
          <Upload className="h-12 w-12 text-blue-500 mb-4" />
          <p className="text-sm text-muted-foreground mb-6">Scan receipt for this trip</p>
          <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileUpload} />
          <Button size="lg" className="px-10" onClick={() => fileInputRef.current?.click()}>
            Take Photo / Select
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="relative aspect-[3/4] rounded-lg overflow-hidden border bg-black shadow-inner">
            <img src={preview} alt="Receipt" className="object-contain w-full h-full" />
            {isScanning && (
              <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center text-white">
                <Loader2 className="animate-spin h-10 w-10 mb-2" />
                <p className="font-bold">Converting to Shekels...</p>
              </div>
            )}
          </div>

          <Button className="w-full h-14 bg-green-600 hover:bg-green-700 font-bold" onClick={() => {
            setPreview(null);
            toast({ title: "Saved", description: "Expense added to sheet." });
          }}>
            <Check className="mr-2" /> Finish or Add Another
          </Button>
        </div>
      )}
    </Card>
  );
};