import React, { useState, useRef } from 'react';
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Loader2, Check, Plane, Edit3, RefreshCcw, LayoutGrid } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const CATEGORIES = ["ארוחות", "טיסות", "נסיעות בתחבורה ציבורית ומוניות", "מלון ולינה", "השכרת רכב", "ביטוח נסיעות וחו״ל", "תקשורת", "הוצאות שונות", "דלק וחניה"];

export const ReceiptScanner = ({ userEmail }: { userEmail: string }) => {
  const [isScanning, setIsScanning] = useState(false);
  const [currentStep, setCurrentStep] = useState<'details' | 'scanner'>('details');
  const [preview, setPreview] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isHeaderSaving, setIsHeaderSaving] = useState(false);
  
  const [tripData, setTripData] = useState({
    userName: 'Jonathan Zvi Shmuely',
    destination: '',
    startDate: new Date().toISOString().split('T')[0],
    returnDate: '',
  });

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
      toast({ title: "AI Offline", description: "Manual entry enabled.", variant: "destructive" });
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
          description: scanResult.description,
          destination: tripData.destination,
          email: userEmail
        }),
      });
      setPreview(null);
      setScanResult(prev => ({ ...prev, amount_ils: '', description: '' }));
      toast({ title: "Saved to Spreadsheet!" });
    } finally {
      setIsSaving(false);
    }
  };

  if (currentStep === 'details') {
    return (
      <Card className="p-8 max-w-xl mx-auto space-y-4">
        <h2 className="text-xl font-bold">Trip Setup</h2>
        <Input placeholder="Destination" value={tripData.destination} onChange={(e) => setTripData({...tripData, destination: e.target.value})} />
        <Button className="w-full" disabled={!tripData.destination} onClick={() => setCurrentStep('scanner')}>Continue</Button>
      </Card>
    );
  }

  return (
    <Card className="p-8 max-w-xl mx-auto space-y-6">
      <div className="flex justify-between items-center border-b pb-2">
        <p className="font-bold">{tripData.destination}</p>
        <Button variant="ghost" size="sm" onClick={() => { localStorage.clear(); window.location.reload(); }}>Full Reset</Button>
      </div>

      {!preview ? (
        <div className="py-20 border-2 border-dashed rounded-xl flex flex-col items-center">
          <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileUpload} />
          <Button onClick={() => fileInputRef.current?.click()}>Upload Receipt</Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
            <img src={preview} className="object-contain w-full h-full" />
            {isScanning && <div className="absolute inset-0 bg-black/60 flex items-center justify-center text-white">Calculating...</div>}
          </div>
          <Input placeholder="Amount in Shekels" type="number" value={scanResult.amount_ils} onChange={(e) => setScanResult({...scanResult, amount_ils: e.target.value})} />
          <Input placeholder="Description" value={scanResult.description} onChange={(e) => setScanResult({...scanResult, description: e.target.value})} />
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setPreview(null)}>Cancel</Button>
            <Button className="flex-[2] bg-green-600" onClick={handleFinalSave} disabled={isSaving || isScanning}>Save Expense</Button>
          </div>
        </div>
      )}
    </Card>
  );
};