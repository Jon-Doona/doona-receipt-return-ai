# Doona Receipt Scanner

An AI-powered travel expense assistant for Doona employees.

## What it does

- Employees enter their email and trip details.
- The app creates a fresh Google Spreadsheet (copy of the company expense template).
- Employees drop receipt photos. AI reads each one and extracts date, merchant, currency, amount, and category.
- Receipts are saved into the correct section of the Hebrew expense sheet, with a link to the uploaded photo in Google Drive.
- When finished, the employee gets an email with the spreadsheet and photo folder links.

## Tech stack

- React 18 + Vite + TypeScript + Tailwind CSS + shadcn/ui
- Supabase Edge Functions (Deno)
- Google Apps Script (company spreadsheet backend)
- Google Sheets / Drive / Gmail via Lovable connector gateway
- Gemini (Lovable AI Gateway) for receipt OCR

## Key files

| File | Role |
|------|------|
| `src/components/ReceiptScanner.tsx` | Main UI — trip setup, drag-drop upload, AI review, save flow |
| `src/components/EmailGate.tsx` | Simple email capture (no password auth) |
| `supabase/functions/scan-receipt/index.ts` | Edge function — proxies GAS, runs AI, uploads to Drive, sends email |
| `HANDOVER.md` | Full architecture, data models, env vars, and gotchas for the next developer |

## Quick start

```bash
bun install
bun run dev
```

See `HANDOVER.md` for the complete developer guide.
