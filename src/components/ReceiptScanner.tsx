import React, { useState, useRef } from 'react';
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Loader2, Check, Plane, Camera, RefreshCcw, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const CATEGORIES = ["ארוחות", "טיסות", "נסיעות בתחבורה ציבורית ומוניות", "מלון ולינה", "השכרת רכב", "ביטוח נסיעות וחו״ל", "תקשורת", "הוצאות שונות", "דלק וחניה"];

// Exchange rates to ILS
const EXCHANGE_RATES: Record<string, number> = {
  'RMB': 0.45,
  'USD': 3.44,
  'EUR': 3.82,
};

interface ReceiptItem {
  id: string;
  file: File;
  preview: string;
  status: 'pending' | 'scanning' | 'done' | 'error';
  errorMsg?: string;
  data: {
    date: string;
    category: string;
    amount: number;  // ILS amount (what the spreadsheet needs)
    currency: string;  // Original currency (RMB/USD/EUR)
    description: string;
    original_amount?: number;  // For display/calculation only
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

  // ===== DEBUG LOGGING UTILITIES =====
  const log = (step: string, message: string, data?: any) => {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] ${step}: ${message}`, data || '');
  };

  const logError = (step: string, error: any) => {
    const timestamp = new Date().toLocaleTimeString();
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[${timestamp}] ❌ ${step} ERROR: ${errorMsg}`, error);
  };

  // ===== HELPER: Strip Base64 Prefix =====
  const stripBase64Prefix = (base64String: string): string => {
    // Remove data:image/...;base64, prefix if present
    if (base64String.includes(',')) {
      return base64String.split(',')[1];
    }
    return base64String;
  };

  // ===== RESILIENT PARSING HELPERS =====
  // Safely extract amount from various possible keys
  const safeParseAmount = (data: any): number => {
    const value =
      data?.amount ||
      data?.amount_ils ||
      data?.total_ils ||
      data?.total ||
      data?.total_amount ||
      data?.sum ||
      data?.amountILS ||
      data?.amount_shekel ||
      data?.shekel_amount ||
      data?.ils ||
      0;

    const num = parseFloat(String(value));
    return isNaN(num) ? 0 : Math.round(num * 100) / 100;
  };

  // Safely extract original amount from extracted data
  const safeParseOriginalAmount = (data: any): number => {
    // Check both the extracted field structure and flat structure
    const value =
      data?.extracted?.amount ||  // Supabase/Gateway returns { extracted: {...} }
      data?.amount ||
      data?.amount_raw ||
      data?.price ||
      data?.total ||
      data?.transaction_amount ||
      data?.subtotal ||
      0;

    const num = parseFloat(String(value));
    return isNaN(num) ? 0 : Math.round(num * 100) / 100;
  };

  // Extract and normalize currency (CNY -> RMB)
  const safeParseAndNormalizeCurrency = (data: any): string => {
    // Check both extracted and flat structure
    let currency = String(
      data?.extracted?.currency ||
      data?.currency ||
      data?.original_currency ||
      data?.code ||
      'USD'
    ).toUpperCase().trim();

    log('PARSE_CURRENCY', 'Raw currency received', { currency });

    // Normalize CNY to RMB
    if (currency === 'CNY') {
      log('PARSE_CURRENCY', 'Normalized CNY → RMB', { original: currency, normalized: 'RMB' });
      currency = 'RMB';
    }

    // Validate against exchange rates
    if (!EXCHANGE_RATES[currency]) {
      log('PARSE_CURRENCY', `Unknown currency "${currency}", defaulting to USD`);
      currency = 'USD';
    }

    return currency;
  };

  // Calculate ILS amount from original amount and currency
  const calculateILSAmount = (originalAmount: number, currency: string): number => {
    if (originalAmount <= 0 || !currency) return 0;
    const rate = EXCHANGE_RATES[currency] || 1;
    const calculated = Math.round(originalAmount * rate * 100) / 100;
    log('CALC_ILS', `${originalAmount} ${currency} × ${rate} = ₪${calculated}`);
    return calculated;
  };

  // POST helper for Apps Script "analyze" stage.
  // Uses text/plain to keep this as a simple CORS request and parse JSON response.
  const postGatewayJson = async (payload: Record<string, unknown>) => {
    const response = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow',
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch (error) {
      logError('GATEWAY_PARSE', error);
      throw new Error(`Gateway returned non-JSON response: ${text.slice(0, 180)}`);
    }
  };

  // ===== MAIN SCANNING LOGIC =====
  const scanReceiptFile = async (receiptItem: ReceiptItem): Promise<void> => {
    const receiptId = receiptItem.id;
    log('SCAN_START', `Starting scan for ${receiptItem.file.name}`, { id: receiptId });

    try {
      // Update status to scanning
      setReceipts(prev =>
        prev.map(r => r.id === receiptId ? { ...r, status: 'scanning' } : r)
      );

      // STEP 1: Read file as Base64
      log('SCAN_STEP1', 'Reading file as Base64...');
      const base64Full = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          log('SCAN_STEP1', 'File read complete', { length: result.length });
          resolve(result);
        };
        reader.onerror = (error) => {
          logError('SCAN_STEP1', error);
          reject(new Error('Failed to read file'));
        };
        reader.readAsDataURL(receiptItem.file);
      });

      // Strip the prefix and send clean Base64
      const base64Clean = stripBase64Prefix(base64Full);
      log('SCAN_STEP1', 'Base64 sanitized', { originalLength: base64Full.length, cleanLength: base64Clean.length });

      // STEP 2: Send to Gateway
      log('SCAN_STEP2', 'Sending to Gateway...', { url: GATEWAY_URL });
      const payload = {
        // Support multiple backend shapes: keep 'action' for Google Apps Script
        // and also include 'mode' + 'imageBase64' for the Supabase function.
        action: "analyze",
        mode: "extract",
        image: base64Clean,
        imageBase64: base64Clean,
        target: "ILS",
      };
      log('SCAN_STEP2', 'Payload created', payload);

      const responseJson = await postGatewayJson(payload);
      log('SCAN_STEP2', 'Gateway response received and parsed');
      log('SCAN_STEP3', 'Parsing Gateway response...');
      log('SCAN_STEP3', 'Full response structure', responseJson);

      if (!responseJson || typeof responseJson !== 'object') {
        throw new Error('Invalid Gateway response structure');
      }

      // The response might be { extracted: {...} } or { error, amount, currency, ... }
      // Check if there's an error from the Gateway
      if (responseJson.error || responseJson.status === 'error') {
        throw new Error(`Gateway error: ${responseJson.error || 'Unknown error'}`);
      }

      // Get the actual extracted data (might be nested under 'extracted' field)
      const aiData = responseJson.extracted || responseJson.data || responseJson;
      log('SCAN_STEP3', 'Extracted data', aiData);

      if (!aiData || typeof aiData !== 'object') {
        throw new Error('Gateway did not return extracted data');
      }

      // Guard against "save success" payloads accidentally returned from analyze route.
      const hasExtractedShape =
        aiData.amount !== undefined ||
        aiData.total !== undefined ||
        aiData.currency !== undefined ||
        aiData.description !== undefined ||
        aiData.destination !== undefined;
      if (!hasExtractedShape) {
        throw new Error(
          `Analyze returned no receipt fields. Received: ${JSON.stringify(responseJson).slice(0, 180)}`
        );
      }

      // Extract values using resilient parsers
      const originalAmount = safeParseOriginalAmount(aiData);
      const currency = safeParseAndNormalizeCurrency(aiData);
      const amountILS = originalAmount > 0 ? calculateILSAmount(originalAmount, currency) : safeParseAmount(aiData);
      const description = String(aiData?.destination || aiData?.description || aiData?.item || aiData?.product || aiData?.merchant || '').substring(0, 100);
      const date = aiData?.date || new Date().toISOString().split('T')[0];
      const category = aiData?.category || 'ארוחות';

      log('SCAN_STEP3', 'Data extracted', {
        originalAmount,
        currency,
        amountILS,
        description,
        date,
        category
      });

      // Update receipt with scanned data
      setReceipts(prev =>
        prev.map(r => {
          if (r.id !== receiptId) return r;
          return {
            ...r,
            status: 'done',
            errorMsg: undefined,
            data: {
              date,
              category,
              amount: amountILS,  // ILS amount
              currency,  // Normalized currency
              description,
              original_amount: originalAmount
            }
          };
        })
      );

      log('SCAN_COMPLETE', `Successfully scanned ${receiptItem.file.name}`);
      toast({ title: "✅ Receipt Scanned", description: receiptItem.file.name });

    } catch (error) {
      logError('SCAN_ERROR', error);
      const errorMsg = error instanceof Error ? error.message : 'Unknown error occurred';

      setReceipts(prev =>
        prev.map(r => {
          if (r.id !== receiptId) return r;
          return {
            ...r,
            status: 'error',
            errorMsg
          };
        })
      );

      toast({
        title: "❌ Scan Failed",
        description: `${receiptItem.file.name}: ${errorMsg}`,
        variant: "destructive"
      });
    }
  };

  // ===== FILE UPLOAD HANDLER (Properly bound) =====
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    try {
      log('FILE_SELECT', 'Step 1: Triggered - File select event fired');
      const files = Array.from(event.target.files || []);

      if (files.length === 0) {
        log('FILE_SELECT', 'No files selected');
        return;
      }

      log('FILE_SELECT', `${files.length} file(s) selected`, { fileNames: files.map(f => f.name) });

      // Process each file
      for (const file of files) {
        log('FILE_SELECT', `Processing file: ${file.name}`, { size: file.size, type: file.type });

        // STEP 2: Create receipt item and generate preview
        const receiptId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        log('FILE_SELECT', 'Step 2: File Read - Generating preview...', { receiptId });

        const previewDataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            log('FILE_SELECT', 'Preview generated', { length: result.length });
            resolve(result);
          };
          reader.onerror = (error) => {
            logError('FILE_SELECT_PREVIEW', error);
            reject(new Error('Failed to generate preview'));
          };
          reader.readAsDataURL(file);
        });

        // Create new receipt item
        const newReceipt: ReceiptItem = {
          id: receiptId,
          file,
          preview: previewDataUrl,
          status: 'pending',
          data: {
            date: new Date().toISOString().split('T')[0],
            category: 'ארוחות',
            amount: 0,
            currency: 'USD',
            description: '',
            original_amount: 0
          },
          savedToSheet: false
        };

        log('FILE_SELECT', 'Receipt item created', { id: receiptId, fileName: file.name });

        // Add to receipts list
        setReceipts(prev => [...prev, newReceipt]);

        // STEP 3: Trigger scan (automatically)
        log('FILE_SELECT', 'Step 3: Payload Sent - Triggering async scan...', { receiptId });
        // Use setTimeout to ensure state update completes first
        setTimeout(() => {
          scanReceiptFile(newReceipt);
        }, 0);
      }

      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
        log('FILE_SELECT', 'Input cleared');
      }

    } catch (error) {
      logError('FILE_SELECT', error);
      toast({
        title: "❌ File Error",
        description: error instanceof Error ? error.message : 'Failed to process files',
        variant: "destructive"
      });
    }
  };

  // ===== SAVE TO SPREADSHEET (Step 2: After analyze) =====
  const saveReceiptToSheet = async (receiptId: string) => {
    try {
      setSavingIds(prev => new Set([...prev, receiptId]));
      log('SAVE_START', 'Saving receipt to sheet...', { receiptId });

      const receipt = receipts.find(r => r.id === receiptId);
      if (!receipt) {
        throw new Error('Receipt not found');
      }

      // Step 2: Send saveExpense action with the verified/edited data
      // This is a SEPARATE call from analyze — we only call this after user confirms the data
      const payload = {
        action: "saveExpense",
        date: receipt.data.date,
        category: receipt.data.category,
        amount: receipt.data.amount,  // ILS amount as NUMBER
        currency: receipt.data.currency,  // Normalized currency (RMB, not CNY)
        description: receipt.data.description,
        destination: tripData.destination,
        reason: tripData.reason,
        email: userEmail,
        startDate: tripData.startDate,
        returnDate: tripData.returnDate
      };

      log('SAVE_PAYLOAD', 'Payload prepared for saveExpense', payload);

      const response = await fetch(GATEWAY_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        redirect: 'follow',
      });

      log('SAVE_RESPONSE', 'Server response received', { status: response.status });
      
      // The response might contain success status or row number
      // We don't strictly need to parse it since mode=no-cors prevents reading it
      // But log it for debugging
      if (response.status !== 200) {
        log('SAVE_RESPONSE', `Received status ${response.status}`);
      }

      setReceipts(prev =>
        prev.map(r => r.id === receiptId ? { ...r, savedToSheet: true } : r)
      );

      log('SAVE_COMPLETE', `Saved ${receipt.file.name}`);
      toast({ title: "✅ Saved to Spreadsheet", description: receipt.file.name });

    } catch (error) {
      logError('SAVE_ERROR', error);
      toast({
        title: "❌ Save Failed",
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

  // ===== UTILITY FUNCTIONS =====
  const deleteReceipt = (receiptId: string) => {
    log('DELETE', `Deleting receipt ${receiptId}`);
    setReceipts(prev => prev.filter(r => r.id !== receiptId));
  };

  const retryReceipt = (receiptId: string) => {
    log('RETRY', `Retrying receipt ${receiptId}`);
    const receipt = receipts.find(r => r.id === receiptId);
    if (receipt) {
      scanReceiptFile(receipt);
    }
  };

  // Live calculation handler
  const updateReceiptField = (receiptId: string, field: string, value: any) => {
    setReceipts(prev =>
      prev.map(r => {
        if (r.id !== receiptId) return r;

        const updated = { ...r };

        if (field === 'original_amount') {
          const numValue = parseFloat(value) || 0;
          updated.data.original_amount = numValue;
          // Auto-recalculate ILS
          updated.data.amount = calculateILSAmount(numValue, updated.data.currency);
          log('UPDATE', 'Original amount changed, ILS recalculated', { receiptId, amount: numValue, currency: updated.data.currency, ils: updated.data.amount });

        } else if (field === 'currency') {
          updated.data.currency = value;
          // Auto-recalculate ILS
          updated.data.amount = calculateILSAmount(updated.data.original_amount || 0, value);
          log('UPDATE', 'Currency changed, ILS recalculated', { receiptId, currency: value, ils: updated.data.amount });

        } else if (field === 'amount') {
          updated.data.amount = parseFloat(value) || 0;

        } else if (field === 'description') {
          updated.data.description = String(value).substring(0, 100);

        } else if (field === 'date') {
          updated.data.date = value;

        } else if (field === 'category') {
          updated.data.category = value;
        }

        return updated;
      })
    );
  };

  // ===== TRIP DETAILS STEP =====
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

  // ===== SCANNER STEP =====
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
          <Button size="lg" className="h-16 px-10 gap-2 shadow-sm" onClick={() => {
            log('BUTTON_CLICK', 'Upload button clicked');
            fileInputRef.current?.click();
          }}>
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
                      onChange={(e) => updateReceiptField(receipt.id, 'description', e.target.value)}
                      placeholder="Receipt item or merchant"
                    />
                  </div>
                  <div>
                    <Label>Category</Label>
                    <Select
                      value={receipt.data.category}
                      onValueChange={(val) => updateReceiptField(receipt.id, 'category', val)}
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
                      onChange={(e) => updateReceiptField(receipt.id, 'date', e.target.value)}
                    />
                  </div>
                  <div className="col-span-2">
                    <Label>Original Amount & Currency</Label>
                    <div className="flex gap-2 items-end">
                      <Select
                        value={receipt.data.currency}
                        onValueChange={(val) => updateReceiptField(receipt.id, 'currency', val)}
                      >
                        <SelectTrigger className="w-24">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.keys(EXCHANGE_RATES).map(curr => (
                            <SelectItem key={curr} value={curr}>{curr}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        type="number"
                        placeholder="0.00"
                        step="0.01"
                        value={receipt.data.original_amount || ''}
                        onChange={(e) => updateReceiptField(receipt.id, 'original_amount', parseFloat(e.target.value))}
                        className="flex-1"
                      />
                      <span className="text-sm text-gray-600 font-mono px-2">
                        @ {EXCHANGE_RATES[receipt.data.currency] || 1}
                      </span>
                    </div>
                  </div>
                  <div className="col-span-2">
                    <Label className="text-blue-600 font-bold">Total in ₪ (Automatically Calculated)</Label>
                    <div className="relative">
                      <Input
                        className="border-blue-400 border-2 font-bold bg-blue-50/50"
                        type="number"
                        value={receipt.data.amount || ''}
                        onChange={(e) => updateReceiptField(receipt.id, 'amount', parseFloat(e.target.value))}
                        placeholder="0.00"
                        step="0.01"
                      />
                      {receipt.data.original_amount && receipt.data.original_amount > 0 && (
                        <p className="text-xs text-gray-500 mt-1">
                          {receipt.data.original_amount} {receipt.data.currency} × {EXCHANGE_RATES[receipt.data.currency] || 1} = ₪{(receipt.data.original_amount * (EXCHANGE_RATES[receipt.data.currency] || 1)).toFixed(2)}
                        </p>
                      )}
                    </div>
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
