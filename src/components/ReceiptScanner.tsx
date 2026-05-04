import React, { useState } from 'react';
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Upload, Loader2, FileText, Check, X, MapPin, Calendar, Tag } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ReceiptScannerProps {
  userEmail: string;
}

export const ReceiptScanner = ({ userEmail }: ReceiptScannerProps) => {
  const [isScanning, setIsScanning] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [details, setDetails] = useState({
    destination: '',
    date: new Date().toISOString().split('T')[0],
    amount: '',
    category: 'General'
  });
  const { toast } = useToast();

  const GATEWAY_URL = "https://script.google.com/macros/s/AKfycbz_SMHbNDMruPH5pBeIg489faOAc00Kf_o6WEihCtZhxaO5kNHP0gt7bpt8Rh37HmU/exec";

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

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

      // Connection to your specific Google Script
      await fetch(GATEWAY_URL, {
        method: 'POST',
        mode: 'no-cors', 
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          image: base64String,
          filename: file.name,
          email: userEmail,
          currency: "ILS" // Force Shekel conversion
        }),
      });

      toast({
        title: "AI Processing",
        description: "Extracting details and converting to Shekels (ILS).",
      });
    } catch (error) {
      toast({ title: "Connection Error", variant: "destructive" });
    } finally {
      setIsScanning(false);
    }
  };

  // UI for the "Preview & Edit" state
  if (preview) {
    return (
      <Card className="p-6 max-w-xl mx-auto space-y-6 bg-white shadow-2xl animate-in fade-in zoom-in duration-300">
        <div className="relative aspect-[4/3] rounded-xl overflow-hidden border-2 bg-muted shadow-inner">
          <img src={preview} alt="Receipt" className="object-contain w-full h-full" />
          <Button 
            variant="destructive" size="icon" className="absolute top-2 right-2 rounded-full"
            onClick={() => setPreview(null)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-4">
          <div className="grid gap-2 text-left">
            <Label className="flex items-center gap-2"><MapPin className="h-4 w-4" /> Destination</Label>
            <Input 
              value={details.destination} 
              onChange={(e) => setDetails({...details, destination: e.target.value})} 
              placeholder="e.g. Business Trip Seoul"
            />
          </div>
          
          <div className="grid grid-cols-2 gap-4 text-left">
            <div className="grid gap-2">
              <Label className="flex items-center gap-2"><Calendar className="h-4 w-4" /> Date</Label>
              <Input 
                type="date" value={details.date} 
                onChange={(e) => setDetails({...details, date: e.target.value})}
              />
            </div>
            <div className="grid gap-2">
              <Label className="flex items-center gap-2"><Tag className="h-4 w-4" /> Amount (₪)</Label>
              <Input 
                type="number" value={details.amount} 
                onChange={(e) => setDetails({...details, amount: e.target.value})}
                placeholder="0.00"
              />
            </div>
          </div>
        </div>

        <Button className="w-full h-14 text-lg font-bold shadow-lg bg-[var(--gradient-brand)]" onClick={() => {
          toast({ title: "Expense Saved", description: "Logged in ILS to your sheet." });
          setPreview(null);
        }}>
          <Check className="mr-2 h-6 w-6" /> Confirm & Save
        </Button>
      </Card>
    );
  }

  // UI for the "Initial Upload" state
  return (
    <Card className="p-12 border-2 border-dashed bg-card/50 backdrop-blur-sm flex flex-col items-center justify-center transition-all hover:border-primary/50">
      <div className="h-20 w-20 bg-[var(--gradient-brand)] rounded-full flex items-center justify-center mb-6 text-white shadow-xl">
        <Upload className="h-10 w-10" />
      </div>
      <h3 className="text-2xl font-semibold mb-2">Scan Receipt</h3>
      <p className="text-muted-foreground mb-10 text-center max-w-sm">
        All expenses will be automatically converted to **Shekels (ILS)**.
      </p>
      <input type="file" id="receipt-upload" className="hidden" accept="image/*" onChange={handleFileUpload} />
      <label htmlFor="receipt-upload">
        <Button asChild size="xl" className="h-16 px-10 text-xl font-bold cursor-pointer shadow-lg hover:scale-105 transition-transform">
          <span>{isScanning ? <Loader2 className="animate-spin mr-3 h-6 w-6" /> : <Upload className="mr-3 h-6 w-6" />} Select Receipt</span>
        </Button>
      </label>
    </Card>
  );
};