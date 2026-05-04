import React, { useState } from 'react';
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Upload, Loader2, FileText } from "lucide-react";
import { Card } from "@/components/ui/card";

interface ReceiptScannerProps {
  userEmail: string;
}

export const ReceiptScanner = ({ userEmail }: ReceiptScannerProps) => {
  const [isScanning, setIsScanning] = useState(false);
  const { toast } = useToast();

  // Your specific Google Script URL
  const GATEWAY_URL = "https://script.google.com/macros/s/AKfycbz_SMHbNDMruPH5pBeIg489faOAc00Kf_o6WEihCtZhxaO5kNHP0gt7bpt8Rh37HmU/exec";

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsScanning(true);
    
    try {
      const reader = new FileReader();
      const base64Promise = new Promise((resolve) => {
        reader.onload = () => {
          const base64String = (reader.result as string).split(',')[1];
          resolve(base64String);
        };
        reader.readAsDataURL(file);
      });

      const base64Data = await base64Promise;

      // Sending to Google Script with Shekel (ILS) instruction
      await fetch(GATEWAY_URL, {
        method: 'POST',
        mode: 'no-cors', 
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          image: base64Data,
          filename: file.name,
          email: userEmail,
          currency: "ILS" 
        }),
      });

      toast({
        title: "Scan initiated",
        description: "The AI is calculating the total in Shekels (ILS). Check your sheet shortly.",
      });

    } catch (error) {
      console.error('Scanner Error:', error);
      toast({
        title: "Scan Failed",
        description: "Check your internet and try again.",
        variant: "destructive",
      });
    } finally {
      setIsScanning(false);
      if (event.target) event.target.value = ''; 
    }
  };

  return (
    <Card className="p-12 border-2 border-dashed bg-card/50 backdrop-blur-sm flex flex-col items-center justify-center transition-all hover:bg-card/80">
      <div className="h-16 w-16 bg-[var(--gradient-brand)] rounded-full flex items-center justify-center mb-6 shadow-lg text-white">
        <FileText className="h-8 w-8" />
      </div>
      
      <h3 className="text-xl font-medium mb-2">Upload Receipt</h3>
      <p className="text-muted-foreground mb-8 text-center max-w-sm">
        Your AI assistant will extract details and convert all costs to Shekels (ILS).
      </p>

      <input
        type="file"
        id="receipt-upload"
        className="hidden"
        accept="image/*"
        onChange={handleFileUpload}
        disabled={isScanning}
      />
      
      <label htmlFor="receipt-upload">
        <Button asChild variant="default" size="xl" className="h-14 px-8 text-lg font-semibold cursor-pointer" disabled={isScanning}>
          <span>
            {isScanning ? (
              <>
                <Loader2 className="mr-3 h-6 w-6 animate-spin" />
                AI is thinking...
              </>
            ) : (
              <>
                <Upload className="mr-3 h-6 w-6" />
                Select Photo
              </>
            )}
          </span>
        </Button>
      </label>
    </Card>
  );
};