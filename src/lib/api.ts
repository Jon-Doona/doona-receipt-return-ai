import { toast } from "@/components/ui/use-toast";

const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzuq3ynvlbXvApvhe9B-d9yERuGlzegNBmE6tPOKxtZ430qruZL7QwYZh-F-s9bIas/exec";

export async function scanReceipt(imageBase64: string, mimeType: string) {
  try {
    const cleanBase64 = imageBase64.replace(/^data:image\/(png|jpg|jpeg);base64,/, "");

    console.log('[scanReceipt] POST → GAS, base64(50):', cleanBase64.substring(0, 50));

    // Apps Script Web Apps respond with a 302 → script.googleusercontent.com.
    // Browsers will follow it transparently as long as the request stays a
    // "simple" CORS request (text/plain body, no custom headers).
    const response = await fetch(GOOGLE_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'analyze',
        imageBase64: cleanBase64,
        mimeType,
      }),
      redirect: 'follow',
    });

    if (!response.ok) {
      throw new Error(`GAS responded ${response.status}. Re-deploy the Apps Script Web App as a NEW version with access = "Anyone".`);
    }

    const raw = await response.text();
    let result: any;
    try {
      result = JSON.parse(raw);
    } catch {
      throw new Error("GAS did not return JSON. Re-deploy the Apps Script Web App as a NEW version.");
    }
    
    if (result.error) {
      throw new Error(result.message || result.error);
    }

    // Normalize: GAS returns { extracted: {...} } or a flat object.
    const data = result.extracted ?? result;
    return {
      amount: data.amount ?? "",
      currency: data.currency ?? "ILS",
      description: data.description ?? "",
      category: data.category ?? "ארוחות",
      date: data.date ?? new Date().toISOString().split("T")[0],
    };

  } catch (error) {
    console.error("❌ SCAN_ERROR:", error);
    toast({
      variant: "destructive",
      title: "Scan Failed",
      description: error instanceof Error ? error.message : "Check Google Script Logs",
    });
    throw error;
  }
}

export async function saveExpense(payload: any) {
  return fetch(GOOGLE_SCRIPT_URL, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'saveExpense', ...payload }),
  });
}