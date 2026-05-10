// Pure Google Apps Script gateway — works on GitHub Pages with no proxy.
// We POST with Content-Type: text/plain so the request stays a "simple"
// CORS request (no preflight). Apps Script web apps return readable JSON
// across origins, so we DO NOT use mode:'no-cors' — we want the response.

// Use environment variable or hardcoded fallback for backward compatibility
const GAS_URL =
  (import.meta.env.VITE_GAS_URL as string | undefined) ||
  "https://script.google.com/macros/s/AKfycbzAi943-KwquQTZWNUUAqCrs1M2rmNWqkdbtZjBHRQwaTd5UtS2mcYCjigaEVFuzfU/exec";

export function getGasUrl(): string {
  // No more errors, it will always return your specific URL
  return GAS_URL;
}
export async function gasPost<T = any>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const url = getGasUrl();
  const res = await fetch(url, {
    method: 'POST',
    // text/plain → no CORS preflight on GitHub Pages
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, ...payload }),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`GAS ${action} failed: ${res.status}`);
  const text = await res.text();
  try { return JSON.parse(text) as T; } catch { return text as unknown as T; }
}

// Fire-and-forget POST for write actions where we cannot/need-not read the
// response. Uses mode:'no-cors' so the browser never blocks the request even
// if the Apps Script deployment doesn't return CORS headers. Response is
// opaque by design — assume success once the request is dispatched.
export async function gasPostNoCors(action: string, payload: Record<string, unknown> = {}): Promise<void> {
  const url = getGasUrl();
  await fetch(url, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, ...payload }),
    redirect: 'follow',
  });
}

// ── Currency conversion (frontend, hardcoded as requested) ──
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
  warnings?: string[];
};

// Ask Apps Script to OCR a receipt. The GAS side should accept
// { action:'scan', imageBase64, mimeType } and return ScanResponse.
export async function scanReceipt(imageBase64: string, mimeType: string) {
  return gasPost<ScanResponse>('scan', { imageBase64, mimeType });
}

export async function saveExpense(payload: {
  date: string;
  category: string;
  amount_ils: number | string;
  original_amount: number | string;
  original_currency: string;
  description: string;
  destination: string;
  email: string;
}) {
  return gasPostNoCors('saveExpense', payload);
}

export async function saveTripHeader(payload: {
  userName: string;
  destination: string;
  startDate: string;
  returnDate: string;
  jobTitle?: string;
  tripPurpose?: string;
  email: string;
}) {
  return gasPostNoCors('saveTripHeader', payload);
}
