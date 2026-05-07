import { toast } from "@/components/ui/use-toast";

export const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzuq3ynvlbXvApvhe9B-d9yERuGlzegNBmE6tPOKxtZ430qruZL7QwYZh-F-s9bIas/exec";

export const getGasUrl = () => GOOGLE_SCRIPT_URL;

// ── Currency conversion ──
export const CURRENCY_TO_ILS_RATES: Record<string, number> = {
  ILS: 1,
  USD: 3.65,
  EUR: 4.05,
  GBP: 4.60,
  JPY: 0.0245,
  CHF: 4.10,
  CAD: 2.70,
  AUD: 2.45,
  CNY: 0.50,
  RMB: 0.50,
  HKD: 0.47,
  THB: 0.10,
};

export const convertToILS = (amount: number, currency: string): number => {
  const rate = CURRENCY_TO_ILS_RATES[currency?.toUpperCase()] ?? 1;
  return Math.round(amount * rate * 100) / 100;
};

export type ScanResponse = {
  amount?: number;
  currency?: string;
  description?: string;
  date?: string;
  category?: string;
  error?: string;
};

/**
 * Main Scanning Function
 * Strips the base64 prefix and calls the 'analyze' action in GAS.
 */
export async function scanReceipt(imageBase64: string, mimeType: string): Promise<ScanResponse> {
  try {
    // 1. Clean the base64 string (Remove "data:image/jpeg;base64,")
    const cleanBase64 = imageBase64.replace(/^data:image\/(png|jpg|jpeg);base64,/, "");

    console.log("🚀 SCAN_START: Sending to Google Apps Script...");
    console.log("[scanReceipt] imageBase64 (first 50 chars):", cleanBase64.substring(0, 50));

    const response = await fetch(GOOGLE_SCRIPT_URL, {
      method: 'POST',
      // We use text/plain to avoid CORS preflight issues on GitHub Pages
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ 
        action: 'analyze', // Matched to your Google Script logic
        imageBase64: cleanBase64, 
        mimeType 
      }),
      redirect: 'follow',
    });

    if (!response.ok) throw new Error(`Network response was not ok: ${response.status}`);

    const result = await response.json();
    
    if (result.error) {
      throw new Error(result.error);
    }

    return result as ScanResponse;

  } catch (error) {
    console.error("❌ SCAN_ERROR:", error);
    toast({
      variant: "destructive",
      title: "Scan Error",
      description: error instanceof Error ? error.message : "Failed to connect to Gemini",
    });
    throw error;
  }
}

/**
 * Save Expense to Sheet
 */
export async function saveExpense(payload: any) {
  return fetch(GOOGLE_SCRIPT_URL, {
    method: 'POST',
    mode: 'no-cors', // Fast fire-and-forget
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'saveExpense', ...payload }),
    redirect: 'follow',
  });
}

/**
 * Save Trip Header to Sheet
 */
export async function saveTripHeader(payload: any) {
  return fetch(GOOGLE_SCRIPT_URL, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'saveTripHeader', ...payload }),
    redirect: 'follow',
  });
}