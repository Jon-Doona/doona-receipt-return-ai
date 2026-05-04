import React, { useState } from 'react';
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Upload, Loader2 } from "lucide-react";

interface ReceiptScannerProps {
  userEmail: string;
}

export const ReceiptScanner = ({ userEmail }: ReceiptScannerProps) => {
  const [isScanning, setIsScanning] = useState(false);
  const { toast } = useToast();

  // HARD-CODED URL TO ENSURE CONNECTION
  const GATEWAY_URL = "https://script.google.com/macros/s/AKfycbz_SMHbNDMruPH5pBeIg489faOAc00Kf_o6WEihCtZhxaO5kNHP0gt7bpt8Rh37HmU/exec";

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsScanning(true);
    
    try {
      // Convert image to Base64
      const reader = new FileReader();
      const base64Promise = new Promise((resolve) => {
        reader.onload = () => {
          const base64String = (reader.result as string).split(',')[1];
          resolve(base64String);
        };
        reader.readAsDataURL(file);
      });

      const base64Data = await base64Promise;

      // Send to Google Script with ILS requirement
      const response = await fetch(GATEWAY_URL, {
        method: 'POST',
        mode: 'no-cors', 
        headers: {
          'Content-Type': 'text/plain;charset=utf-8',
        },
        body: JSON.stringify({
          image: base64Data,
          filename: file.name,
          email: userEmail,
          targetCurrency: "ILS" // Enforces Shekel calculation
        }),
      });

      // Since mode is 'no-cors', we show a success toast based on the trigger
      toast({
        title: "Upload Triggered",
        description: "Checking receipt and converting to Shekels (ILS). Check your sheet in 10 seconds.",
      });

    } catch (error) {
      console.error('Scanner Error:', error);
      toast({
        title: "Scan Failed",
        description: "Could not reach the AI. Check your internet or deployment permissions.",
        variant: "destructive",
      });
    } finally {
      setIsScanning(false);
      if (event.target) event.target.value = ''; // Reset input
    }
  };

  return (
    <div className="flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-xl bg-card/50">
      <input
        type="file"
        id="receipt-upload"
        className="hidden"
        accept="image/*"
        onChange={handleFileUpload}
        disabled={isScanning}
      />
      <label htmlFor="receipt-upload">
        <Button asChild variant="default" size="lg" className="cursor-pointer shadow-lg" disabled={isScanning}>
          <span>
            {isScanning ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Upload className="mr-2 h-5 w-5" />
                Scan Receipt
              </>
            )}
          </span>
        </Button>
      </label>
      <p className="mt-4 text-sm text-muted-foreground">
        Upload a JPG or PNG. The AI will convert prices to ₪ (ILS).
      </p>
    </div>
  );
};