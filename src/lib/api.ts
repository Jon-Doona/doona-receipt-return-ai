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
 * 
 * Architecture: Browser -> GAS (doPost) -> Gemini 1.5 Flash -> Browser
 */
export async function scanReceipt(imageBase64: string, mimeType: string): Promise<ScanResponse> {
  try {
    // 1. VALIDATE INPUT
    if (!imageBase64 || imageBase64.length === 0) {
      throw new Error("No image data provided");
    }

    // 2. CLEAN BASE64 (Remove "data:image/jpeg;base64," prefix if present)
    const cleanBase64 = imageBase64.replace(/^data:image\/(png|jpg|jpeg|webp);base64,/, "");
    console.log("✅ [scanReceipt] Base64 cleaned");
    console.log(`   Original length: ${imageBase64.length}, Clean length: ${cleanBase64.length}`);
    console.log(`   First 50 chars: ${cleanBase64.substring(0, 50)}...`);

    // 3. BUILD PAYLOAD
    const payload = {
      action: 'analyze',
      imageBase64: cleanBase64,
      mimeType: mimeType || 'image/jpeg'
    };
    
    const payloadJson = JSON.stringify(payload);
    console.log(`📦 [scanReceipt] Payload built: ${payloadJson.length} bytes`);
    console.log(`   URL: ${GOOGLE_SCRIPT_URL}`);

    // 4. SEND TO GAS
    console.log("🚀 [scanReceipt] Sending POST request to Google Apps Script...");
    
    const response = await fetch(GOOGLE_SCRIPT_URL, {
      method: 'POST',
      // text/plain to avoid CORS preflight on GitHub Pages
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: payloadJson,
      redirect: 'follow',
    });

    console.log(`📬 [scanReceipt] Response received: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const text = await response.text();
      console.error(`❌ [scanReceipt] HTTP error: ${response.status}`);
      console.error(`   Response body: ${text.substring(0, 300)}`);
      throw new Error(`HTTP ${response.status}: ${response.statusText}\n${text}`);
    }

    // 5. PARSE RESPONSE
    const responseText = await response.text();
    console.log(`📄 [scanReceipt] Response text (first 300 chars):\n${responseText.substring(0, 300)}`);
    
    let result: ScanResponse;
    try {
      result = JSON.parse(responseText);
    } catch (parseErr) {
      console.error(`❌ [scanReceipt] Failed to parse JSON response:`, parseErr);
      throw new Error(`Invalid JSON response from GAS: ${responseText.substring(0, 100)}`);
    }

    console.log(`✅ [scanReceipt] Parsed result:`, result);

    // 6. CHECK FOR ERRORS IN RESPONSE
    if (result.error) {
      console.error(`❌ [scanReceipt] GAS returned error:`, result.error);
      throw new Error(`GAS Error: ${result.error}`);
    }

    // 7. VALIDATE EXTRACTED DATA
    if (!result.extracted) {
      console.warn(`⚠️  [scanReceipt] No 'extracted' field in response. Full result:`, result);
      // If response is the extracted data directly, use it
      if (result.amount !== undefined || result.currency !== undefined) {
        return result as ScanResponse;
      }
      throw new Error("No extracted data returned from Gemini");
    }

    console.log(`🎉 [scanReceipt] SUCCESS: Extracted data received`, result.extracted);
    return result as ScanResponse;

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`❌ [scanReceipt] FATAL ERROR:`, errorMsg);
    console.error(`   Full error:`, error);
    
    toast({
      variant: "destructive",
      title: "Scan Failed",
      description: errorMsg,
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