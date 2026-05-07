import { toast } from "@/components/ui/use-toast";

const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzuq3ynvlbXvApvhe9B-d9yERuGlzegNBmE6tPOKxtZ430qruZL7QwYZh-F-s9bIas/exec";

export async function scanReceipt(imageBase64: string, mimeType: string) {
  try {
    // Strip prefix
    const cleanBase64 = imageBase64.replace(/^data:image\/(png|jpg|jpeg);base64,/, "");

    const response = await fetch(GOOGLE_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ 
        action: 'analyze', 
        imageBase64: cleanBase64, 
        mimeType 
      }),
      redirect: 'follow',
    });

    const result = await response.json();
    
    if (result.error) {
      throw new Error(result.message || result.error);
    }

    toast({ title: "Scan Complete", description: "Receipt added to RAW sheet." });
    return result;

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