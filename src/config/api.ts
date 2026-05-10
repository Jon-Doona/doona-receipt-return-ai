// Google Apps Script backend URL for public worker use.
// Override locally by setting VITE_GAS_URL in your .env file.
export const GAS_URL =
  (import.meta.env.VITE_GAS_URL as string | undefined) ||
  "https://script.google.com/macros/s/AKfycbzAi943-KwquQTZWNUUAqCrs1M2rmNWqkdbtZjBHRQwaTd5UtS2mcYCjigaEVFuzfU/exec";

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

// ── Receipt scanning ──
export const gasAnalyzeReceipt = (payload: { imageBase64: string; mimeType?: string }) =>
  postGas("analyze", payload);

// ── Expense saving (appends to sheet starting from Row 18) ──
export const gasSaveExpense = (payload: Record<string, unknown>) =>
  postGas("saveExpense", payload);

// ── Options fetching (categories, currencies, payment methods) ──
export type OptionsResponse = {
  categories: string[];
  currencies: string[];
  payment_methods: { id: string; label: string }[];
};

export const gasGetOptions = () =>
  postGas<OptionsResponse>("getOptions", {});

// ── Trip creation (saves initial setup to Row 12) ──
export type CreateTripResponse = {
  spreadsheetId: string;
  sheetId: number;
  sheetTitle: string;
  sheetUrl: string;
  sections: Array<{ title: string; header_row: number; first_data_row: number; last_data_row: number }>;
  folderId?: string;
  folderUrl?: string;
  error?: string;
};

export const gasCreateTrip = (payload: {
  traveler_name: string;
  role?: string;
  country: string;
  purpose?: string;
  from_date: string;
  to_date: string;
  business_days?: number;
  itinerary?: Array<{ destination: string; from: string; to: string }>;
  user_email?: string;
}) =>
  postGas<CreateTripResponse>("createTrip", payload);

// ── Sheet verification ──
export const gasVerifySheet = (payload: { spreadsheetId: string; sheetId: number }) =>
  postGas<{ exists: boolean }>("verifySheet", payload);

// ── Image upload to Drive ──
export type ImageUploadResponse = {
  webViewLink: string;
  fileId: string;
  name: string;
  error?: string;
};

export const gasUploadImageToDrive = (payload: {
  imageBase64: string;
  filename: string;
  userEmail: string;
  mimeType?: string;
  folderId?: string | null;
}) =>
  postGas<ImageUploadResponse>("uploadImage", payload);

// ── Email report sending ──
export const gasSendEmail = (payload: {
  userEmail: string;
  sheetUrl: string;
  sheetTitle: string;
  folderUrl?: string | null;
  receiptCount: number;
}) =>
  postGas<{ success: boolean }>("sendEmail", payload);