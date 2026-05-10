// Google Apps Script backend URL.
// Override locally by setting VITE_GAS_URL in your .env file.
export const GAS_URL =
  (import.meta.env.VITE_GAS_URL as string | undefined) ||
  "https://script.google.com/macros/s/AKfycbz2-WXtCQzy63HiwuV70ifwNdNLbuE6M7ko_iamcZ25hYay1UobewIuD4PbHwNPhrU/exec";

async function postGas<T = any>(action: string, payload: Record<string, unknown>): Promise<T> {
  const res = await fetch(GAS_URL, {
    method: "POST",
    // Apps Script web apps don't accept custom headers without preflight;
    // send as text/plain so the browser skips the CORS preflight.
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!res.ok) throw new Error(`Backend error ${res.status}`);
  const data = await res.json();
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export const gasAnalyzeReceipt = (payload: { imageBase64: string; mimeType?: string }) =>
  postGas("analyze", payload);

export const gasSaveExpense = (payload: Record<string, unknown>) =>
  postGas("saveExpense", payload);