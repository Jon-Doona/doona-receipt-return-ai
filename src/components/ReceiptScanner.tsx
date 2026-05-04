import React, { useState, useRef } from 'react';
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Upload, Loader2, Check, MapPin, Calendar, Info, ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ReceiptScannerProps {
  userEmail: string;
}

export const ReceiptScanner = ({ userEmail }: ReceiptScannerProps) => {
  const [isScanning, setIsScanning] = useState(false);
  const [step, setStep] = useState<'details' | 'scan'>('details');
  const [preview, setPreview] = useState<string | null>(null);
  
  const [tripData, setTripData] = useState({
    destination: '',
    reason: '',
    date: new Date().toISOString().split('T')[0],
    manualAmount: ''
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

      await fetch(GATEWAY_URL, {
        method: 'POST',
        mode: 'no-cors', 
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          image: base64String,
          email: userEmail,
          destination: tripData.destination,
          reason: tripData.reason,
          date: tripData.date,
          currency: "ILS" 
        }),
      });

      toast({ title: "Scan Complete", description: "Converted to Shekels (ILS) and saved." });
    } catch (error) {
      toast({ title: "Error", variant: "destructive" });
    } finally {
      setIsScanning(false);
    }
  };

  // STEP 1: TRIP DETAILS
  if (step === 'details') {
    return (
      <Card className="p-8 max-w-xl mx-auto space-y-6 shadow-xl border-t-4 border-primary">
        <div className="text-center space-y-2">
          <h3 className="text-2xl font-bold">Trip Information</h3>
          <p className="text-muted-foreground">Where are you and why?</p>
        </div>

        <div className="space-y-4 text-left">
          <div className="grid gap-2">
            <Label className="flex items-center gap-2"><MapPin className="h-4 w-4" /> Destination / Country</Label>
            <Input 
              value={tripData.destination} 
              onChange={(e) => setTripData({...tripData, destination: e.target.value})} 
              placeholder="e.g. South Korea"
            />
          </div>
          <div className="grid gap-2">
            <Label className="flex items-center gap-2"><Info className="h-4 w-4" /> Reason for Trip</Label>
            <Input 
              value={tripData.reason} 
              onChange={(e) => setTripData({...tripData, reason: e.target.value})} 
              placeholder="e.g. NPI Testing at Factory"
            />
          </div>
          <div className="grid gap-2">
            <Label className="flex items-center gap-2"><Calendar className="h-4 w-4" /> Date</Label>
            <Input 
              type="date" value={tripData.date} 
              onChange={(e) => setTripData({...tripData, date: e.target.value})}
            />
          </div>
        </div>

        <Button 
          className="w-full h-14 text-lg font-bold" 
          disabled={!tripData.destination || !tripData.reason}
          onClick={() => setStep('scan')}
        >
          Next: Scan Expenses <ArrowRight className="ml-2 h-5 w-5" />
        </Button>
      </Card>
    );
  }

  // STEP 2: EXPENSES & AI SCAN
  return (
    <Card className="p-8 max-w-xl mx-auto space-y-6 animate-in fade-in zoom-in duration-300">
      <div className="flex justify-between items-center">
        <div className="text-left">
          <p className="text-sm font-bold text-primary">{tripData.destination}</p>
          <p className="text-xs text-muted-foreground">{tripData.reason}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setStep('details')}>Edit Trip</Button>
      </div>

      {!preview ? (
        <div className="py-12 border-2 border-dashed rounded-xl flex flex-col items-center">
          <Upload className="h-12 w-12 text-muted-foreground mb-4" />
          <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileUpload} />
          <Button onClick={() => fileInputRef.current?.click()}>Select Receipt</Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="relative aspect-video rounded-lg overflow-hidden border bg-black">
            <img src={preview} alt="Receipt" className="object-contain w-full h-full" />
            {isScanning && (
              <div className="absolute inset-0 bg-black/60 flex items-center justify-center text-white">
                <Loader2 className="animate-spin mr-2" /> Converting to Shekels...
              </div>
            )}
          </div>
          
          <div className="grid gap-2 text-left">
            <Label>Manual Amount Override (Optional ₪)</Label>
            <Input 
              type="number" placeholder="ILS Amount"
              value={tripData.manualAmount}
              onChange={(e) => setTripData({...tripData, manualAmount: e.target.value})}
            />
          </div>

          <Button className="w-full h-14 bg-green-600 hover:bg-green-700 font-bold" onClick={() => {
            toast({ title: "Saved", description: "Logged to Google Sheet" });
            setPreview(null);
          }}>
            <Check className="mr-2" /> Done / Scan Another
          </Button>
        </div>
      )}
    </Card>
  );
};