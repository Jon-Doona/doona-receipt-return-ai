# Receipt → דוח החזר Pipeline Plan

## 1. Storage: move receipt images to Supabase

The `receipts` Storage bucket already exists (private). We'll use it as the single source of truth for receipt files and stop relying on Drive for the cell link.

- Make the bucket **public-read** (via migration) so `=HYPERLINK()` cells open without auth. Writes stay restricted to the edge function via the service role.
- New edge function `upload-receipt` (Supabase) that:
  1. Accepts `{ imageBase64, mimeType, filename, tripId }`
  2. Uploads to `receipts/{tripId}/{uuid}-{filename}`
  3. Returns the public URL + storage path
- Client calls this **before** writing to the sheet. If it fails → abort, show toast: *"Failed to upload receipt image. Please try again."* No sheet write happens.

(Drive upload via GAS is removed from the save flow.)

## 2. Extraction + categorization with confidence

Update the GAS `analyze` action (or move to a Supabase edge function `scan-receipt` using Lovable AI / Gemini) to return:

```
{ date, vendor, expense_type, currency, amount,
  category_he,            // one of the דוח החזר section headers
  category_confidence }   // 0..1
```

Allowed `category_he` values come from the sheet section list, e.g.:
`טיסות`, `נסיעות בתחבורה ציבורית`, `אש"ל`, `לינה`, `אחר`, etc. (final list pulled from the template once during build).

Client flow:
- `confidence ≥ 0.95` → auto-assign category.
- `confidence < 0.95` → mark receipt `needs_confirmation`, show a category `<Select>` populated from the section list; user must pick before "Save" enables.

## 3. Sheet write targeting (`דוח החזר` sheet)

Update GAS `saveExpense` so instead of appending at row 18, it:
1. Opens the `דוח החזר` sheet of the trip spreadsheet.
2. Looks up the section by Hebrew header (`category_he`) using a stored map of `{ header → first_data_row, last_data_row, columns }` (already discovered during `createTrip` and returned in `sections`).
3. Scans that section top-down for the first row where the `סכום` column is empty.
4. Writes: Date, Vendor, Expense Type detail, Currency, Amount into the correct columns (preserving existing `=VLOOKUP` for `בש"ח`).
5. Writes the receipt URL into the `אסמכתא` column as:
   `=HYPERLINK("<public_url>","קבלה")`
6. Returns `{ row, column_map }` so the client can show "saved to row N of <section>".

If the section is full → return error: *"No empty row left in section <name>. Add a row to the template."*

## 4. Validation & fail-safe

- Storage upload must succeed before any `saveExpense` call (client enforces, edge function also re-checks the URL is reachable).
- `saveExpense` is wrapped in try/catch; on failure the client surfaces the GAS error verbatim and keeps the receipt in `ready` state for retry.
- Confidence gate blocks save until category is confirmed.

## 5. Schema / config changes

- **Migration**: flip `receipts` bucket to public, add RLS policy `SELECT for anon`, keep `INSERT/UPDATE/DELETE` to `service_role` only.
- **Secrets**: none new (uses existing `SUPABASE_SERVICE_ROLE_KEY` server-side).
- **GAS template**: needs the section header → row range map exposed by `createTrip` (it already returns `sections`; we'll extend it with the column indices for `סכום`, `אסמכתא`, `תאריך`, `ספק`, `מטבע`, `סכום מקור`).

## 6. Files touched

- `supabase/functions/upload-receipt/index.ts` *(new)* — storage upload
- `supabase/migrations/<ts>_receipts_public.sql` *(new)* — bucket policies
- `src/config/api.ts` — add `uploadReceiptToSupabase`, drop `gasUploadImageToDrive` from the save path
- `src/components/ReceiptScanner.tsx` — confidence gate UI, manual category `<Select>`, new save flow (Supabase upload → GAS saveExpense with `public_url`)
- GAS web app (out-of-repo, you'll redeploy): update `analyze` to return `category_he` + `category_confidence`; update `saveExpense` to target section rows and write `=HYPERLINK(...)` into `אסמכתא`; extend `createTrip` `sections` payload with column indices and Hebrew header names.

## Open questions

1. Confirm the canonical list of `דוח החזר` section headers (Hebrew strings) I should match against — easiest is for me to read them from the live template via the Sheets connector. OK to do that?
2. Should the receipt `אסמכתא` link label be `"קבלה"`, the filename, or the row's vendor name?
3. When a section is full, prefer **(a)** append a new row inside that section automatically, or **(b)** error out and let you edit the template?