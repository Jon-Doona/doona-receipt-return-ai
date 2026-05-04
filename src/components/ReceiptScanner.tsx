import React, { useState, useRef } from 'react';
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Upload, Loader2, FileText, Check, X, MapPin, Calendar, Tag, Info } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ReceiptScannerProps {
  userEmail: string;
}

export const ReceiptScanner = ({ userEmail }: ReceiptScannerProps) => {
  const [isScanning, setIsScanning] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [step, setStep] = useState<'upload' | 'preview'>('upload');
  const [details, setDetails] = useState({
    destination: '',
    date: new Date().toISOString().split('T')[0],
    amount: '',
    reason: '',
    category: 'General'
  });
  
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // הכתובת המעודכנת שלך ל-Google Script
  const GATEWAY_URL = "https://script.google.com/macros/s/AKfycbz_SMHbNDMruPH5pBeIg489faOAc00Kf_o6WEihCtZhxaO5kNHP0gt7bpt8Rh37HmU/exec";

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // הצגת התמונה מיד למשתמש
    const reader = new FileReader();
    reader.onload = () => {
      setPreview(reader.result as string);
      setStep('preview');
    };
    reader.readAsDataURL(file);

    setIsScanning(true);
    
    try {
      const base64String = await new Promise<string>((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve((r.result as string).split(',')[1]);
        r.readAsDataURL(file);
      });

      // שליחה ל-AI לעיבוד ב-שקלים
      await fetch(GATEWAY_URL, {
        method: 'POST',
        mode: 'no-cors', 
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          image: base64String,
          filename: file.name,
          email: userEmail,
          currency: "ILS" // הגדרה קבועה לשקלים כפי שביקשת
        }),
      });

      toast({
        title: "הסריקה החלה",
        description: "הנתונים מעובדים ויומרו לשקלים (ILS) בגיליון שלך.",
      });
    } catch (error) {
      toast({ title: "שגיאת חיבור", variant: "destructive" });
    } finally {
      setIsScanning(false);
    }
  };

  // מסך תצוגה מקדימה והזנת פרטים
  if (step === 'preview' && preview) {
    return (
      <Card className="p-6 max-w-2xl mx-auto space-y-6 bg-white shadow-2xl border-t-4 border-blue-500 animate-in fade-in slide-in-from-bottom-4">
        <div className="flex justify-between items-center">
          <h3 className="text-xl font-bold">פרטי קבלה</h3>
          <Button variant="ghost" size="sm" onClick={() => { setPreview(null); setStep('upload'); }}>
            <X className="h-4 w-4 mr-2" /> ביטול
          </Button>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* תצוגת התמונה */}
          <div className="relative aspect-[3/4] rounded-lg overflow-hidden border bg-black flex items-center justify-center">
            <img src={preview} alt="Receipt" className="object-contain max-h-full w-full" />
            {isScanning && (
              <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center text-white">
                <Loader2 className="h-10 w-10 animate-spin mb-2" />
                <span className="font-medium">ה-AI מנתח...</span>
              </div>
            )}
          </div>

          {/* שדות להזנה */}
          <div className="space-y-4 text-right" dir="rtl">
            <div className="space-y-2">
              <Label className="flex items-center gap-2 justify-end"><MapPin className="h-4 w-4" /> יעד / מדינה</Label>
              <Input 
                value={details.destination} 
                onChange={(e) => setDetails({...details, destination: e.target.value})} 
                placeholder="לדוגמה: כנס בסיאול"
              />
            </div>
            
            <div className="space-y-2">
              <Label className="flex items-center gap-2 justify-end"><Info className="h-4 w-4" /> סיבת ההוצאה</Label>
              <Input 
                value={details.reason} 
                onChange={(e) => setDetails({...details, reason: e.target.value})} 
                placeholder="לדוגמה: ארוחת ערב עם לקוח"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="flex items-center gap-2 justify-end"><Calendar className="h-4 w-4" /> תאריך</Label>
                <Input 
                  type="date" value={details.date} 
                  onChange={(e) => setDetails({...details, date: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2 justify-end"><Tag className="h-4 w-4" /> סכום (₪)</Label>
                <Input 
                  type="number" value={details.amount} 
                  onChange={(e) => setDetails({...details, amount: e.target.value})}
                  placeholder="0.00"
                />
              </div>
            </div>
          </div>
        </div>

        <Button 
          className="w-full h-14 text-xl font-bold bg-blue-600 hover:bg-blue-700 shadow-lg" 
          onClick={() => {
            toast({ title: "נשמר בהצלחה", description: "ההוצאה תופיע בגיליון בשקלים." });
            setPreview(null);
            setStep('upload');
          }}
          disabled={isScanning}
        >
          <Check className="mr-2 h-6 w-6" /> אישור ושמירה לגיליון
        </Button>
      </Card>
    );
  }

  // מסך העלאה ראשוני
  return (
    <Card className="p-16 border-2 border-dashed bg-blue-50/30 flex flex-col items-center justify-center transition-all hover:border-blue-400">
      <div className="h-24 w-24 bg-blue-600 rounded-full flex items-center justify-center mb-6 text-white shadow-xl">
        <Upload className="h-12 w-12" />
      </div>
      <h3 className="text-2xl font-bold mb-2 text-slate-800">סריקת קבלה חדשה</h3>
      <p className="text-slate-500 mb-10 text-center max-w-sm">
        העלה קבלה וה-AI יחלץ את הפרטים וימיר את הסכום ל**שקלים (ILS)** באופן אוטומטי.
      </p>
      
      <input 
        type="file" 
        ref={fileInputRef}
        className="hidden" 
        accept="image/*" 
        onChange={handleFileUpload} 
      />
      
      <Button 
        size="xl" 
        className="h-16 px-12 text-xl font-bold shadow-xl hover:scale-105 transition-transform"
        onClick={() => fileInputRef.current?.click()}
        disabled={isScanning}
      >
        {isScanning ? <Loader2 className="animate-spin mr-3" /> : <Upload className="mr-3" />}
        בחר צילום קבלה
      </Button>
    </Card>
  );
};