import React, { useState, useRef } from 'react';
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Loader2, Check, Plane, Camera, RefreshCcw, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const CATEGORIES = ["ארוחות", "טיסות", "נסיעות בתחבורה ציבורית ומוניות", "מלון ולינה", "השכרת רכב", "ביטוח נסיעות וחו״ל", "תקשורת", "הוצאות שונות", "דלק וחניה"];

interface ReceiptItem {
  id: string;
  file: File;
  preview: string;
  status: 'pending' | 'scanning' | 'done' | 'error';
  errorMsg?: string;
  data: {
    amount_ils: string;
    original_amount: string;
    original_currency: string;
    description: string;
    date: string;
    category: string;
  };
  savedToSheet: boolean;
}

export const ReceiptScanner = ({ userEmail }: { userEmail: string }) => {
  const [currentStep, setCurrentStep] = useState<'details' | 'scanner'>('details');
  const [receipts, setReceipts] = useState<ReceiptItem[]>([]);
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  
  const [tripData, setTripData] = useState({
    userName: 'Jonny',
    role: 'Industrial Designer',
    destination: '',
    reason: '',
    startDate: new Date().toISOString().split('T')[0],
    returnDate: '',
  });

  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const GATEWAY_URL = "https://script.google.com/macros/s/AKfycbzuq3ynvlbXvApvhe9B-d9yERuGlzegNBmE6tPOKxtZ430qruZL7QwYZh-F-s9bIas/exec";

  // Safely extract amount from response (checks multiple possible keys)
  const extractAmount = (data: any): string => {
    return (data?.amount_ils || data?.total_ils || data?.amount || data?.total || '').toString();
  };

  // Safely extract original amount from response
  const extractOriginalAmount = (data: any): string => {
    return (data?.amount_raw || data?.original_amount || data?.price || '').toString();
  };

  // Safely extract currency from response
  const extractCurrency = (data: any): string => {
    return data?.currency || data?.original_currency || data?.code || '';
  };

  // Process a single file: upload, scan, and update state
  const scanReceipt = async (receiptItem: ReceiptItem) => {
    const updatedReceipt = { ...receiptItem, status: 'scanning' as const };
    setReceipts(prev => prev.map(r => r.id === receiptItem.id ? updatedReceipt : r));

    try {
      const base64String = await new Promise<string>((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve((r.result as string).split(',')[1]);
        r.readAsDataURL(receiptItem.file);
      });

      const response = await fetch(GATEWAY_URL, {
        method: 'POST',
        body: JSON.stringify({ image: base64String, action: "analyze", target: "ILS" }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: Server error`);
      }

      const data = await response.json();

      // Gracefully handle response even if malformed
      if (!data || typeof data !== 'object') {
        throw new Error('Invalid JSON response');
      }

      const processedReceipt = {
        ...receiptItem,
        status: 'done' as const,
        data: {
          amount_ils: extractAmount(data),
          original_amount: extractOriginalAmount(data),
          original_currency: extractCurrency(data),
          description: data?.description || '',
          date: data?.date || new Date().toISOString().split('T')[0],
          category: data?.category || 'ארוחות'
        },
        errorMsg: undefined
      };
      setReceipts(prev => prev.map(r => r.id === receiptItem.id ? processedReceipt : r));
      toast({ title: "Receipt Scanned", description: receiptItem.file.name });

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      const failedReceipt = {
        ...receiptItem,
        status: 'error' as const,
        errorMsg: errorMsg
      };
      setReceipts(prev => prev.map(r => r.id === receiptItem.id ? failedReceipt : r));
      toast({
        title: "Scan Failed",
        description: `${receiptItem.file.name}: ${errorMsg}`,
        variant: "destructive"
      });
    }
  };

  // Handle multiple file uploads
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    const newReceipts: ReceiptItem[] = [];

    for (const file of files) {
      const reader = new FileReader();
      
      reader.onload = async (e) => {
        const preview = e.target?.result as string;
        const id = `${Date.now()}_${Math.random()}`;

        const newReceipt: ReceiptItem = {
          id,
          file,
          preview,
          status: 'pending',
          data: {
            amount_ils: '',
            original_amount: '',
            original_currency: '',
            description: '',
            date: new Date().toISOString().split('T')[0],
            category: 'ארוחות'
          },
          savedToSheet: false
        };

        setReceipts(prev => [...prev, newReceipt]);

        // Auto-scan after adding to list
        await scanReceipt(newReceipt);
      };

      reader.readAsDataURL(file);
    }

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Save individual receipt to spreadsheet
  const saveReceiptToSheet = async (receiptId: string) => {
    setSavingIds(prev => new Set([...prev, receiptId]));

    try {
      const receipt = receipts.find(r => r.id === receiptId);
      if (!receipt) return;

      const response = await fetch(GATEWAY_URL, {
        method: 'POST',
        mode: 'no-cors',
        body: JSON.stringify({
          action: "saveExpense",
          date: receipt.data.date,
          category: receipt.data.category,
          amount_ils: receipt.data.amount_ils,
          original_amount: receipt.data.original_amount,
          original_currency: receipt.data.original_currency,
          description: receipt.data.description,
          destination: tripData.destination,
          reason: tripData.reason,
          email: userEmail,
          startDate: tripData.startDate,
          returnDate: tripData.returnDate
        }),
      });

      setReceipts(prev =>
        prev.map(r => r.id === receiptId ? { ...r, savedToSheet: true } : r)
      );

      toast({
        title: "Saved",
        description: receipt.file.name
      });
    } catch (error) {
      toast({
        title: "Save Failed",
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: "destructive"
      });
    } finally {
      setSavingIds(prev => {
        const next = new Set(prev);
        next.delete(receiptId);
        return next;
      });
    }
  };

  // Delete receipt from list
  const deleteReceipt = (receiptId: string) => {
    setReceipts(prev => prev.filter(r => r.id !== receiptId));
  };

  // Retry scanning a receipt
  const retryReceipt = async (receiptId: string) => {
    const receipt = receipts.find(r => r.id === receiptId);
    if (receipt) {
      await scanReceipt(receipt);
    }
  };

  // Trip Details Step
  if (currentStep === 'details') {
    return (
      <Card className="p-8 max-w-xl mx-auto space-y-6 text-left">
        <div className="flex items-center gap-3 border-b pb-4">
          <Plane className="h-6 w-6 text-blue-600" />
          <div>
            <h2 className="text-xl font-bold">Trip Setup</h2>
            <p className="text-xs text-gray-500 uppercase">{tripData.userName} | {tripData.role}</p>
          </div>
        </div>
        <div className="space-y-4">
          <div>
            <Label>Destination</Label>
            <Input placeholder="Country/City" value={tripData.destination} onChange={(e) => setTripData({...tripData, destination: e.target.value})} />
          </div>
          <div>
            <Label>Purpose of Trip</Label>
            <Input placeholder="Reason for travel" value={tripData.reason} onChange={(e) => setTripData({...tripData, reason: e.target.value})} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Start Date</Label>
              <Input type="date" value={tripData.startDate} onChange={(e) => setTripData({...tripData, startDate: e.target.value})} />
            </div>
            <div>
              <Label>Return Date</Label>
              <Input type="date" value={tripData.returnDate} onChange={(e) => setTripData({...tripData, returnDate: e.target.value})} />
            </div>
          </div>
          <Button className="w-full h-12 text-lg font-semibold" disabled={!tripData.destination} onClick={() => setCurrentStep('scanner')}>
            Next: Scan Receipts
          </Button>
        </div>
      </Card>
    );
  }

  // Calculate stats
  const totalReceipts = receipts.length;
  const savedReceipts = receipts.filter(r => r.savedToSheet).length;
  const pendingReceipts = receipts.filter(r => r.status === 'pending' || r.status === 'scanning').length;

  return (
    <div className="max-w-4xl mx-auto space-y-6 text-left p-4">
      {/* Header */}
      <Card className="p-6">
        <div className="flex justify-between items-start">
          <div>
            <p className="text-xs font-bold text-blue-600 uppercase tracking-tighter">
              {tripData.destination} {tripData.reason ? `— ${tripData.reason}` : ''}
            </p>
            <p className="text-lg font-semibold mt-1">{tripData.startDate} to {tripData.returnDate}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => window.location.reload()}>
            <RefreshCcw className="h-4 w-4 mr-2" /> Reset
          </Button>
        </div>

        {/* Progress Stats */}
        <div className="mt-4 grid grid-cols-3 gap-4 text-sm">
          <div className="bg-blue-50 p-3 rounded border border-blue-200">
            <p className="text-blue-600 font-bold">{totalReceipts}</p>
            <p className="text-gray-600 text-xs">Total Receipts</p>
          </div>
          <div className="bg-amber-50 p-3 rounded border border-amber-200">
            <p className="text-amber-600 font-bold">{pendingReceipts}</p>
            <p className="text-gray-600 text-xs">Processing</p>
          </div>
          <div className="bg-emerald-50 p-3 rounded border border-emerald-200">
            <p className="text-emerald-600 font-bold">{savedReceipts}</p>
            <p className="text-gray-600 text-xs">Saved</p>
          </div>
        </div>
      </Card>

      {/* Upload Area */}
      <Card className="p-6">
        <div className="py-12 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center bg-slate-50">
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept="image/*"
            multiple
            onChange={handleFileUpload}
          />
          <Button size="lg" className="h-16 px-10 gap-2 shadow-sm" onClick={() => fileInputRef.current?.click()}>
            <Camera className="h-6 w-6" /> Upload Multiple Receipts
          </Button>
          <p className="text-sm text-gray-500 mt-3">Select one or more receipt images</p>
        </div>
      </Card>

      {/* Receipts List */}
      {receipts.length > 0 && (
        <div className="space-y-4">
          <h3 className="font-bold text-lg">Processing Receipts ({receipts.length})</h3>
          {receipts.map(receipt => (
            <Card key={receipt.id} className="p-6 space-y-4">
              {/* Receipt Header */}
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <p className="font-semibold text-sm">{receipt.file.name}</p>
                  <p className="text-xs text-gray-500">
                    {receipt.file.size} bytes
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {receipt.status === 'pending' && (
                    <span className="text-xs px-2 py-1 bg-gray-100 rounded">Pending</span>
                  )}
                  {receipt.status === 'scanning' && (
                    <span className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" /> Scanning
                    </span>
                  )}
                  {receipt.status === 'done' && !receipt.savedToSheet && (
                    <span className="text-xs px-2 py-1 bg-amber-100 text-amber-700 rounded">Ready to Save</span>
                  )}
                  {receipt.savedToSheet && (
                    <span className="text-xs px-2 py-1 bg-emerald-100 text-emerald-700 rounded flex items-center gap-1">
                      <Check className="h-3 w-3" /> Saved
                    </span>
                  )}
                  {receipt.status === 'error' && (
                    <span className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded">Error</span>
                  )}
                </div>
              </div>

              {/* Receipt Preview */}
              <div className="relative aspect-[4/3] bg-black rounded-lg overflow-hidden border-2">
                <img src={receipt.preview} className="object-contain w-full h-full" alt={receipt.file.name} />
                {receipt.status === 'scanning' && (
                  <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center text-white">
                    <Loader2 className="animate-spin h-10 w-10 mb-2" />
                    <p className="font-bold tracking-widest text-sm uppercase">Processing...</p>
                  </div>
                )}
              </div>

              {/* Error Message */}
              {receipt.status === 'error' && (
                <div className="bg-red-50 border border-red-200 rounded p-3">
                  <p className="text-sm text-red-700"><strong>Error:</strong> {receipt.errorMsg}</p>
                </div>
              )}

              {/* Form Fields */}
              {(receipt.status === 'done' || receipt.status === 'error') && (
                <div className="grid grid-cols-2 gap-4 pt-2 border-t">
                  <div className="col-span-2">
                    <Label>Description</Label>
                    <Input
                      value={receipt.data.description}
                      onChange={(e) =>
                        setReceipts(prev =>
                          prev.map(r =>
                            r.id === receipt.id
                              ? { ...r, data: { ...r.data, description: e.target.value } }
                              : r
                          )
                        )
                      }
                    />
                  </div>
                  <div>
                    <Label>Category</Label>
                    <Select
                      value={receipt.data.category}
                      onValueChange={(val) =>
                        setReceipts(prev =>
                          prev.map(r =>
                            r.id === receipt.id
                              ? { ...r, data: { ...r.data, category: val } }
                              : r
                          )
                        )
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CATEGORIES.map(cat => (
                          <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Date</Label>
                    <Input
                      type="date"
                      value={receipt.data.date}
                      onChange={(e) =>
                        setReceipts(prev =>
                          prev.map(r =>
                            r.id === receipt.id
                              ? { ...r, data: { ...r.data, date: e.target.value } }
                              : r
                          )
                        )
                      }
                    />
                  </div>
                  <div>
                    <Label>Original Amount</Label>
                    <div className="flex gap-2">
                      <Input
                        className="w-16 px-2 text-center font-mono text-xs uppercase"
                        placeholder="CNY"
                        value={receipt.data.original_currency}
                        onChange={(e) =>
                          setReceipts(prev =>
                            prev.map(r =>
                              r.id === receipt.id
                                ? { ...r, data: { ...r.data, original_currency: e.target.value } }
                                : r
                            )
                          )
                        }
                      />
                      <Input
                        type="number"
                        placeholder="0.00"
                        value={receipt.data.original_amount}
                        onChange={(e) =>
                          setReceipts(prev =>
                            prev.map(r =>
                              r.id === receipt.id
                                ? { ...r, data: { ...r.data, original_amount: e.target.value } }
                                : r
                            )
                          )
                        }
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="text-blue-600 font-bold">Total (₪)</Label>
                    <Input
                      className="border-blue-400 border-2 font-bold bg-blue-50/50"
                      type="number"
                      value={receipt.data.amount_ils}
                      onChange={(e) =>
                        setReceipts(prev =>
                          prev.map(r =>
                            r.id === receipt.id
                              ? { ...r, data: { ...r.data, amount_ils: e.target.value } }
                              : r
                          )
                        )
                      }
                    />
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-3 pt-4 border-t">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => deleteReceipt(receipt.id)}
                  className="text-red-600 hover:text-red-700"
                >
                  <Trash2 className="h-4 w-4 mr-2" /> Delete
                </Button>

                {receipt.status === 'error' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => retryReceipt(receipt.id)}
                    className="text-amber-600 hover:text-amber-700 ml-auto"
                  >
                    <RefreshCcw className="h-4 w-4 mr-2" /> Retry
                  </Button>
                )}

                {!receipt.savedToSheet && receipt.status !== 'scanning' && receipt.status !== 'pending' && (
                  <Button
                    size="sm"
                    className="bg-emerald-600 hover:bg-emerald-700 shadow-md ml-auto"
                    onClick={() => saveReceiptToSheet(receipt.id)}
                    disabled={savingIds.has(receipt.id)}
                  >
                    {savingIds.has(receipt.id) ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...
                      </>
                    ) : (
                      <>
                        <Check className="h-4 w-4 mr-2" /> Save
                      </>
                    )}
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};