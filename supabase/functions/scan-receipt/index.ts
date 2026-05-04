import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

/*
  Doona Trip Expense Assistant — backend

  Modes:
    - "options"       → return locked categories / currencies / payment methods
    - "create_trip"   → duplicate the master "דוח החזר" template tab inside the same spreadsheet,
                        rename it, then write the trip header + itinerary into it.
                        Returns the new sheetId, sheet title, and a parsed section map (where
                        each category lives in the new sheet) so the client can preview them.
    - "extract"       → run AI on a single receipt image and return structured fields
    - "fill_receipt"  → write a single (validated) receipt into the next free row of its
                        category section in the trip's tab
*/

const SHEETS_GATEWAY = "https://connector-gateway.lovable.dev/google_sheets/v4";
const DRIVE_GATEWAY = "https://connector-gateway.lovable.dev/google_drive/drive/v3";
const DRIVE_UPLOAD_GATEWAY = "https://connector-gateway.lovable.dev/google_drive/upload/drive/v3";
const GMAIL_GATEWAY = "https://connector-gateway.lovable.dev/google_mail/gmail/v1";
const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

// MASTER spreadsheet (the company template). We never write into this — every
// new trip gets a full Drive copy of this whole file so individual workers
// can't see or modify other trips. The copy is shared read-only with the
// worker so the emailed report is uneditable by them or anyone else.
const MASTER_SPREADSHEET_ID = "1Lyr3ghfgaBLM7Sdoz6v5mRbuENxGC2zw9XjVwskJQl8";
const TEMPLATE_SHEET_TITLE = "דוח החזר"; // template tab inside the master file
const SUMMARY_SHEET_TITLE = "דוח נסיעה לחו\"ל "; // master "trip summary" tab — note trailing space
const RAW_SHEET_TITLE = "RAW";

// Locked dropdowns — match the company sheet exactly.
const CATEGORIES = [
  "טיסות",
  "נסיעות בתחבורה ציבורית",
  "לינה ללא ארוחות",
  "השכרת רכב",
  "אירוח אורחים בחול",
  "תקשורת",
  "ארוחות",
  "הוצאות שונות",
  "ללא קבלות",
];
const CURRENCIES = ["ILS", "USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "CNY", "RMB", "HKD", "THB"];
const PAYMENT_METHODS_HE: Record<string, string> = {
  company_card: "כ. אשראי חברה",
  employee: "העובד",
};

type Section = {
  title: string;
  header_row: number;     // 1-based row index of "תאריך" header
  first_data_row: number; // first writable row
  last_data_row: number;  // last writable row (inclusive, before "סה\"כ")
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const GOOGLE_SHEETS_API_KEY = Deno.env.get("GOOGLE_SHEETS_API_KEY");
    const GOOGLE_DRIVE_API_KEY = Deno.env.get("GOOGLE_DRIVE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");
    if (!GOOGLE_SHEETS_API_KEY) throw new Error("GOOGLE_SHEETS_API_KEY not configured");

    const sheetsHeaders = {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": GOOGLE_SHEETS_API_KEY,
      "Content-Type": "application/json",
    };

    const body = await req.json();
    const { mode } = body;

    // ─────────────────────────────────────────────
    // upload_drive — upload one receipt image to the shared Google Drive
    // ─────────────────────────────────────────────
    if (mode === "upload_drive") {
      if (!GOOGLE_DRIVE_API_KEY) return jsonErr("GOOGLE_DRIVE_API_KEY not configured", 500);
      const { imageBase64, filename, userEmail, mimeType, folderId } = body;
      if (!imageBase64) return jsonErr("imageBase64 required", 400);
      if (!filename || typeof filename !== "string") return jsonErr("filename required", 400);
      if (!userEmail || typeof userEmail !== "string") return jsonErr("userEmail required", 400);

      const driveHeaders = {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": GOOGLE_DRIVE_API_KEY,
      };

      // Tag the file with the worker's email so receipts are attributable.
      const safeEmail = userEmail.replace(/[^a-zA-Z0-9@._-]/g, "_");
      const safeOriginal = filename.replace(/[\r\n]/g, "_").slice(0, 200);
      const stamped = `${safeEmail}__${Date.now()}__${safeOriginal}`;
      const fileMime = (typeof mimeType === "string" && mimeType) || "image/jpeg";

      // Decode base64 → bytes
      const bin = atob(imageBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

      // Multipart upload (metadata + media in one request)
      const boundary = "doona-" + crypto.randomUUID();
      const metadata = {
        name: stamped,
        description: `Receipt uploaded by ${userEmail}`,
        properties: { uploadedBy: userEmail, originalName: safeOriginal },
        ...(folderId ? { parents: [folderId] } : {}),
      };
      const enc = new TextEncoder();
      const head = enc.encode(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
          JSON.stringify(metadata) +
          `\r\n--${boundary}\r\nContent-Type: ${fileMime}\r\nContent-Transfer-Encoding: binary\r\n\r\n`,
      );
      const tail = enc.encode(`\r\n--${boundary}--`);
      const payload = new Uint8Array(head.length + bytes.length + tail.length);
      payload.set(head, 0);
      payload.set(bytes, head.length);
      payload.set(tail, head.length + bytes.length);

      const uploadResp = await fetch(
        `${DRIVE_UPLOAD_GATEWAY}/files?uploadType=multipart&fields=id,name,webViewLink,webContentLink`,
        {
          method: "POST",
          headers: {
            ...driveHeaders,
            "Content-Type": `multipart/related; boundary=${boundary}`,
          },
          body: payload,
        },
      );
      if (!uploadResp.ok) {
        const t = await uploadResp.text();
        return jsonErr(`Drive upload failed [${uploadResp.status}]: ${t}`, 500);
      }
      const file = await uploadResp.json();

      // Make the file readable by anyone with the link, so it can be opened
      // from the spreadsheet without each viewer needing extra access.
      try {
        await fetch(`${DRIVE_GATEWAY}/files/${file.id}/permissions`, {
          method: "POST",
          headers: { ...driveHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({ role: "reader", type: "anyone" }),
        });
      } catch (_) { /* non-fatal */ }

      const webViewLink =
        file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`;
      return ok({
        fileId: file.id,
        name: file.name,
        webViewLink,
        webContentLink: file.webContentLink,
      });
    }

    // ─────────────────────────────────────────────
    // options
    // ─────────────────────────────────────────────
    if (mode === "options") {
      return ok({
        categories: CATEGORIES,
        currencies: CURRENCIES,
        payment_methods: [
          { id: "company_card", label: "Company credit card" },
          { id: "employee", label: "Paid by employee" },
        ],
      });
    }

    // ─────────────────────────────────────────────
    // verify_sheet — does this sheet tab still exist?
    // ─────────────────────────────────────────────
    if (mode === "verify_sheet") {
      const { sheetId, spreadsheetId } = body;
      if (sheetId === undefined || sheetId === null) return jsonErr("sheetId required", 400);
      const ssId = spreadsheetId || MASTER_SPREADSHEET_ID;
      const resp = await fetch(
        `${SHEETS_GATEWAY}/spreadsheets/${ssId}?fields=sheets.properties.sheetId`,
        { headers: sheetsHeaders },
      );
      if (!resp.ok) return ok({ exists: false });
      const j = await resp.json();
      const exists = (j.sheets || []).some((s: any) => s?.properties?.sheetId === sheetId);
      return ok({ exists });
    }

    // ─────────────────────────────────────────────
    // create_trip — duplicate template tab + write header + itinerary
    // ─────────────────────────────────────────────
    if (mode === "create_trip") {
      const { traveler_name, role, country, purpose, from_date, to_date, itinerary, userEmail } = body;
      if (!traveler_name?.trim()) return jsonErr("traveler_name required", 400);
      if (!country?.trim()) return jsonErr("country required", 400);
      if (!from_date || !to_date) return jsonErr("from_date / to_date required", 400);
      if (!GOOGLE_DRIVE_API_KEY) return jsonErr("GOOGLE_DRIVE_API_KEY not configured (required to copy the master spreadsheet)", 500);

      // Auto-calculate business days (Mon-Fri count, inclusive) from the date range.
      // Falls back to total inclusive day count if parsing fails.
      const business_days = calcBusinessDays(from_date, to_date);

      const tabTitle =
        `${traveler_name.trim()} – ${country.trim()} – ${from_date}`
          .slice(0, 90)
          .replace(/[\\\/\?\*\[\]]/g, "-");

      const driveHeaders = {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": GOOGLE_DRIVE_API_KEY,
        "Content-Type": "application/json",
      };

      // 1. COPY the entire master spreadsheet via Drive. Each trip gets its
      //    own isolated workbook so workers can never see or affect other
      //    trips. The new file is named after the trip.
      const copyResp = await fetch(
        `${DRIVE_GATEWAY}/files/${MASTER_SPREADSHEET_ID}/copy?fields=id,webViewLink`,
        {
          method: "POST",
          headers: driveHeaders,
          body: JSON.stringify({ name: `Doona — ${tabTitle}` }),
        },
      );
      if (!copyResp.ok) {
        throw new Error(`Copy master spreadsheet failed [${copyResp.status}]: ${await copyResp.text()}`);
      }
      const copyJson = await copyResp.json();
      const newSpreadsheetId: string = copyJson.id;

      // 2. Find the template sheet (and summary sheet) inside the copy —
      //    sheetIds are preserved across a Drive copy, but we look up by
      //    title to be safe.
      const metaResp = await fetch(
        `${SHEETS_GATEWAY}/spreadsheets/${newSpreadsheetId}?fields=sheets.properties(sheetId,title)`,
        { headers: sheetsHeaders },
      );
      if (!metaResp.ok) throw new Error(`Read copy metadata failed [${metaResp.status}]: ${await metaResp.text()}`);
      const metaJson = await metaResp.json();
      const sheetsMeta: Array<{ sheetId: number; title: string }> =
        (metaJson.sheets || []).map((s: any) => s.properties);
      const templateSheet = sheetsMeta.find((s) => s.title === TEMPLATE_SHEET_TITLE);
      if (!templateSheet) throw new Error(`Template tab "${TEMPLATE_SHEET_TITLE}" not found in copied spreadsheet`);
      const newSheetId: number = templateSheet.sheetId;

      // 3. Rename the template tab to the trip title.
      const renameResp = await fetch(
        `${SHEETS_GATEWAY}/spreadsheets/${newSpreadsheetId}:batchUpdate`,
        {
          method: "POST",
          headers: sheetsHeaders,
          body: JSON.stringify({
            requests: [{
              updateSheetProperties: {
                properties: { sheetId: newSheetId, title: tabTitle },
                fields: "title",
              },
            }],
          }),
        },
      );
      if (!renameResp.ok) throw new Error(`Rename trip tab failed [${renameResp.status}]: ${await renameResp.text()}`);
      const newSheetTitle: string = tabTitle;

      // 4. Read the new sheet's content so we can compute section ranges
      const sections = await loadSections(sheetsHeaders, newSpreadsheetId, newSheetId);

      // 5. Fill header fields at LOCKED coordinates (matching the master template):
      //    Traveler name → D7 ; role → D8 (top yellow form cells).
      //    Itinerary row (row 12, shifted down one from the previous mapping):
      //      B12 = country, E12 = start date, F12 = end date, G12 = business days.
      //    rowIndex / columnIndex are 0-based.
      const headerRequests = [
        cellWrite(newSheetId, 6, 3, traveler_name.trim()), // D7
        cellWrite(newSheetId, 8, 3, role || ""),           // D9
        cellWrite(newSheetId, 11, 2, country.trim()),      // C12
        cellWrite(newSheetId, 11, 4, from_date),           // E12
        cellWrite(newSheetId, 11, 5, to_date),             // F12
        cellWrite(newSheetId, 11, 6, business_days || ""), // G12
        cellWrite(newSheetId, 11, 3, purpose || ""),       // D12 — trip purpose
      ];
      // itinerary not written under the locked layout
      void itinerary;

      const updResp = await fetch(
        `${SHEETS_GATEWAY}/spreadsheets/${newSpreadsheetId}:batchUpdate`,
        {
          method: "POST",
          headers: sheetsHeaders,
          body: JSON.stringify({ requests: headerRequests }),
        },
      );
      if (!updResp.ok) throw new Error(`Header write failed [${updResp.status}]: ${await updResp.text()}`);

      // Re-point the summary tab's SUMIFS formulas at the newly-created trip tab
      // so the per-category totals (C18:C26) actually fill in.
      try {
        await rewriteSummaryFormulas(sheetsHeaders, newSpreadsheetId, newSheetTitle);
      } catch (e) {
        console.error("rewriteSummaryFormulas failed:", e);
      }

      // 6. Share the new spreadsheet with the worker as READ-ONLY so the
      //    emailed report cannot be edited (or shared with others) by the
      //    recipient. Best-effort: if userEmail isn't supplied we still
      //    return the trip.
      try {
        if (userEmail && typeof userEmail === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail)) {
          await fetch(
            `${DRIVE_GATEWAY}/files/${newSpreadsheetId}/permissions?sendNotificationEmail=false`,
            {
              method: "POST",
              headers: driveHeaders,
              body: JSON.stringify({ role: "reader", type: "user", emailAddress: userEmail }),
            },
          );
        }
      } catch (e) {
        console.error("share copy with user failed:", e);
      }

      // Create a per-trip Drive folder for the photos. Best effort — if the
      // Drive call fails we still return the trip so receipts can be saved.
      let folderId: string | null = null;
      let folderUrl: string | null = null;
      if (GOOGLE_DRIVE_API_KEY) {
        try {
          const folderResp = await fetch(`${DRIVE_GATEWAY}/files?fields=id,webViewLink`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
              "X-Connection-Api-Key": GOOGLE_DRIVE_API_KEY,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              name: `Doona receipts — ${newSheetTitle}`,
              mimeType: "application/vnd.google-apps.folder",
            }),
          });
          if (folderResp.ok) {
            const f = await folderResp.json();
            folderId = f.id;
            folderUrl = f.webViewLink || `https://drive.google.com/drive/folders/${f.id}`;
            // Anyone with link → reader, so the worker can browse photos.
            await fetch(`${DRIVE_GATEWAY}/files/${folderId}/permissions`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${LOVABLE_API_KEY}`,
                "X-Connection-Api-Key": GOOGLE_DRIVE_API_KEY,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ role: "reader", type: "anyone" }),
            }).catch(() => undefined);
          }
        } catch (_) { /* non-fatal */ }
      }

      return ok({
        spreadsheetId: newSpreadsheetId,
        sheetId: newSheetId,
        sheetTitle: newSheetTitle,
        sheetUrl: `https://docs.google.com/spreadsheets/d/${newSpreadsheetId}/edit#gid=${newSheetId}`,
        sections,
        folderId,
        folderUrl,
      });
    }

    // ─────────────────────────────────────────────
    // extract — run AI on a single receipt image
    // ─────────────────────────────────────────────
    if (mode === "extract") {
      const { imageBase64, mimeType } = body;
      if (!imageBase64) return jsonErr("imageBase64 required", 400);

      let aiResp!: Response;
      let _delay = 3000;
      for (let _attempt = 0; _attempt < 3; _attempt++) {
      aiResp = await fetch(AI_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            {
              role: "system",
              content:
                "You extract structured business expense data from receipt images for a Hebrew company expense report. Always call extract_receipt. Rules: " +
                "date must be YYYY-MM-DD; " +
                "currency must be one of: " + CURRENCIES.join(", ") + "; " +
                "CURRENCY DETECTION IS CRITICAL — read the receipt very carefully. Follow this exact decision process:\n" +
                "STEP 1 — Identify the COUNTRY/LANGUAGE of the receipt first (look at the script, address, phone country code, tax IDs like VAT/GST/TVA, language of headers like 'Total', 'סה\"כ', 'รวม', '合计', '合計', 'Total', 'Sub-total').\n" +
                "STEP 2 — Match country to default currency unless a different currency symbol is explicitly printed.\n" +
                "Country → currency defaults: Thailand→THB, Israel→ILS, Japan→JPY, China→CNY, Hong Kong→HKD, USA→USD, UK→GBP, Eurozone (DE/FR/IT/ES/NL/IE/PT/AT/BE/FI/GR etc.)→EUR, Switzerland→CHF, Canada→CAD, Australia→AUD.\n" +
                "STEP 3 — Symbol/text clues (override defaults only when unambiguous):\n" +
                "  • ₪ / NIS / שח / ש\"ח / שקל → ILS\n" +
                "  • ฿ / THB / บาท / Thai script (ก-๙) anywhere → THB (Thai Baht). A bare 'B' next to amounts on a Thai receipt is also THB.\n" +
                "  • ¥ on a Japanese receipt (Japanese kana/kanji like 円, 領収書, 合計) → JPY\n" +
                "  • ¥ / 元 / RMB / CNY / 人民币 on a Chinese receipt → CNY\n" +
                "  • HK$ / HKD / 港幣 → HKD\n" +
                "  • US$ / USD, or '$' on a clearly US receipt → USD\n" +
                "  • CA$ / C$ / CAD → CAD;  A$ / AUD → AUD\n" +
                "  • € / EUR → EUR;  £ / GBP / GBX → GBP;  CHF / Fr. / SFr → CHF\n" +
                "CRITICAL: A bare '$' is ambiguous — use the country to disambiguate (could be USD, CAD, AUD, HKD, etc.). A bare '¥' is ambiguous between JPY and CNY — use the country/language.\n" +
                "NEVER default to ILS. NEVER default to USD. If no symbol is visible, USE THE COUNTRY OF THE MERCHANT to pick the currency. Only fall back to USD as a last resort if you truly cannot identify the country.\n" +
                `category MUST be one of (Hebrew, exact match): ${CATEGORIES.join(" | ")}. ` +
                "Map: flights/airline → טיסות; taxi/uber/train/bus/parking/fuel → נסיעות בתחבורה ציבורית; " +
                "hotel without meals → לינה ללא ארוחות; car rental → השכרת רכב; client entertainment → אירוח אורחים בחול; " +
                "phone/internet/SIM → תקשורת; restaurant/food → ארוחות; anything else → הוצאות שונות. " +
                "payment_method: 'company_card' if it looks like a corporate Visa/Mastercard, otherwise 'employee'. " +
                "amount is a positive number with no currency symbol; " +
                "destination is the city + short merchant (max 50 chars).",
            },
            {
              role: "user",
              content: [
                { type: "text", text: "Extract the receipt fields." },
                {
                  type: "image_url",
                  image_url: { url: `data:${mimeType || "image/jpeg"};base64,${imageBase64}` },
                },
              ],
            },
          ],
          tools: [{
            type: "function",
            function: {
              name: "extract_receipt",
              parameters: {
                type: "object",
                properties: {
                  date: { type: "string" },
                  destination: { type: "string", description: "City + short merchant name" },
                  currency: { type: "string", enum: CURRENCIES, description: "ISO currency code matching the symbol/text on the receipt. Do not default to ILS." },
                  amount: { type: "number" },
                  category: { type: "string", enum: CATEGORIES },
                  payment_method: { type: "string", enum: ["company_card", "employee"] },
                  raw_text: { type: "string", description: "Verbatim text visible on the receipt, used to validate currency." },
                },
                required: ["date", "destination", "currency", "amount", "category", "payment_method", "raw_text"],
                additionalProperties: false,
              },
            },
          }],
          tool_choice: { type: "function", function: { name: "extract_receipt" } },
        }),
      });
        if (aiResp.status !== 429) break;
        await new Promise((r) => setTimeout(r, _delay));
        _delay *= 2;
      }

      if (!aiResp.ok) {
        const t = await aiResp.text();
        if (aiResp.status === 429) return ok({ retryable: true, retryAfterMs: 45000, error: "AI is busy — waiting and retrying automatically." });
        if (aiResp.status === 402) return jsonErr("AI credits exhausted. Add funds in Settings → Workspace → Usage.", 402);
        throw new Error(`AI error [${aiResp.status}]: ${t}`);
      }
      const aiJson = await aiResp.json();
      const toolCall = aiJson.choices?.[0]?.message?.tool_calls?.[0];
      if (!toolCall) throw new Error("AI did not return structured data");
      const extracted = JSON.parse(toolCall.function.arguments);

      // Sanity check: if the extracted currency symbol/code doesn't appear anywhere in the
      // raw_text the AI itself transcribed, the model probably guessed wrong. Surface a
      // warning so the UI can highlight it for human review.
      const warnings: string[] = [];
      const raw = (extracted.raw_text || "").toString();
      const symbolMap: Record<string, string[]> = {
        ILS: ["₪", "ILS", "NIS", "שח", "ש\"ח", "שקל"],
        THB: ["฿", "THB", "บาท", "Baht"],
        JPY: ["¥", "JPY", "円", "yen"],
        CNY: ["¥", "CNY", "RMB", "元", "人民币"],
        RMB: ["RMB", "¥", "元"],
        HKD: ["HK$", "HKD", "港幣"],
        USD: ["US$", "USD", "$"],
        EUR: ["€", "EUR"],
        GBP: ["£", "GBP"],
        CHF: ["CHF", "Fr"],
        CAD: ["CAD", "C$"],
        AUD: ["AUD", "A$"],
      };
      const tokens = symbolMap[extracted.currency] || [extracted.currency];
      const found = raw && tokens.some((t) => raw.toLowerCase().includes(t.toLowerCase()));
      if (raw && !found) {
        warnings.push(`Currency "${extracted.currency}" not found in receipt text — please double-check.`);
      }

      return ok({ extracted, warnings });
    }

    // ─────────────────────────────────────────────
    // fill_receipt — write into next free row of category section
    // ─────────────────────────────────────────────
    if (mode === "fill_receipt") {
      const { sheetId, receipt } = body;
      if (!sheetId && sheetId !== 0) return jsonErr("sheetId required", 400);
      if (!receipt) return jsonErr("receipt required", 400);

      // Validation
      const errs: string[] = [];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(receipt.date || "")) errs.push("date must be YYYY-MM-DD");
      if (!CATEGORIES.includes(receipt.category)) errs.push("invalid category");
      if (!CURRENCIES.includes(receipt.currency)) errs.push("invalid currency");
      if (!["company_card", "employee"].includes(receipt.payment_method)) errs.push("invalid payment_method");
      const amount = Number(receipt.amount);
      if (!isFinite(amount) || amount <= 0) errs.push("amount must be > 0");
      if (errs.length) return jsonErr("Validation failed: " + errs.join(", "), 400);

      // ── PER-CATEGORY SECTION LAYOUT ───────────────────────────────
      // Each category has its own block in the sheet. We locate the
      // block that matches receipt.category, then write into the next
      // empty row inside that block (between the header row and the
      // "סה\"כ" totals row).
      //
      // Column map (0-based columnIndex):
      //   C(2) = תאריך       (date)
      //   D(3) = יעדים       (description / vendor)
      //   E(4) = סוג מטבע    (currency code)
      //   F(5) = סכום        (amount, numeric, original currency)
      //   G(6) = בש"ח        (amount in ILS — formula or value)
      //   H(7) = שולם ע"י    (paid by — left blank, dropdown)
      //   I(8) = אסמכתא      (Drive link to the receipt photo)
      const sections = await loadSections(sheetsHeaders, sheetId);
      const section = sections.find((s) => s.title === receipt.category);
      if (!section) {
        return jsonErr(`No section found for category "${receipt.category}"`, 400);
      }

      // Probe column C within this section to find first empty row.
      const probe = await fetch(
        `${SHEETS_GATEWAY}/spreadsheets/${SPREADSHEET_ID}/values:batchGetByDataFilter`,
        {
          method: "POST",
          headers: sheetsHeaders,
          body: JSON.stringify({
            dataFilters: [{
              gridRange: {
                sheetId,
                startRowIndex: section.first_data_row - 1,
                endRowIndex: section.last_data_row,
                startColumnIndex: 2,
                endColumnIndex: 3,
              },
            }],
            valueRenderOption: "FORMATTED_VALUE",
          }),
        },
      );
      if (!probe.ok) throw new Error(`Probe failed [${probe.status}]: ${await probe.text()}`);
      const probeJson = await probe.json();
      const colC: string[][] = probeJson.valueRanges?.[0]?.valueRange?.values || [];
      const sectionSize = section.last_data_row - (section.first_data_row - 1);
      let targetRow = -1;
      for (let i = 0; i < sectionSize; i++) {
        const cell = (colC[i]?.[0] || "").trim();
        if (!cell) { targetRow = section.first_data_row + i; break; }
      }
      if (targetRow === -1) {
        return jsonErr(`Section "${section.title}" is full`, 400);
      }
      const rowIdx = targetRow - 1;

      // Description: prefer destination, fall back to category for context.
      const description = (receipt.destination || receipt.category || "").toString();

      const requests: any[] = [
        cellWrite(sheetId, rowIdx, 2, receipt.date),     // C = date
        cellWrite(sheetId, rowIdx, 3, description),      // D = description
        cellWrite(sheetId, rowIdx, 4, receipt.currency), // E = currency
        cellWrite(sheetId, rowIdx, 5, amount),           // F = amount
        ilsFormulaWrite(sheetId, rowIdx, 6, targetRow, receipt.currency), // G = ILS
      ];
      if (receipt.drive_url) {
        requests.push(linkWrite(sheetId, rowIdx, 8, receipt.drive_url, "קבלה")); // I
      }

      const upd = await fetch(
        `${SHEETS_GATEWAY}/spreadsheets/${SPREADSHEET_ID}:batchUpdate`,
        {
          method: "POST",
          headers: sheetsHeaders,
          body: JSON.stringify({ requests }),
        },
      );
      if (!upd.ok) throw new Error(`Write failed [${upd.status}]: ${await upd.text()}`);

      // Also append a flat row to the RAW tab so we have a single ledger
      // across all trips (the summary tab SUMIFS already pulls from the
      // per-trip tab, RAW is just for export / auditing).
      try {
        await appendRawRow(sheetsHeaders, {
          date: receipt.date,
          category: receipt.category,
          amount,
          currency: receipt.currency,
          description,
          payment_method: PAYMENT_METHODS_HE[receipt.payment_method] || receipt.payment_method,
          city: receipt.city || "",
          country: receipt.country || "",
          filename: receipt.filename || "",
          drive_url: receipt.drive_url || "",
          raw_text: receipt.raw_text || "",
        });
      } catch (e) {
        console.error("appendRawRow failed:", e);
      }

      return ok({ row: targetRow });
    }

    // ─────────────────────────────────────────────
    // send_email — email the worker the trip sheet + photos folder links
    // ─────────────────────────────────────────────
    if (mode === "send_email") {
      const GOOGLE_MAIL_API_KEY = Deno.env.get("GOOGLE_MAIL_API_KEY");
      if (!GOOGLE_MAIL_API_KEY) return jsonErr("GOOGLE_MAIL_API_KEY not configured", 500);
      const { userEmail, sheetUrl, sheetTitle, folderUrl, receiptCount } = body;
      if (!userEmail || typeof userEmail !== "string") return jsonErr("userEmail required", 400);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail)) return jsonErr("Invalid email address", 400);
      if (!sheetUrl || !sheetTitle) return jsonErr("sheetUrl and sheetTitle required", 400);

      const subject = `Your Doona expense report — ${sheetTitle}`;
      const photosBlock = folderUrl
        ? `<p style="margin:0 0 12px;">📁 <a href="${folderUrl}" style="color:#2563eb;">Photos folder</a> — all your receipt images</p>`
        : "";
      const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f8fafc;padding:24px;">
  <div style="max-width:560px;margin:auto;background:#fff;border-radius:12px;padding:28px;box-shadow:0 1px 3px rgba(0,0,0,.06);">
    <h2 style="margin:0 0 12px;color:#0f172a;">Your trip is wrapped up ✅</h2>
    <p style="margin:0 0 20px;color:#475569;">Trip: <strong>${escapeHtml(sheetTitle)}</strong>${
        receiptCount ? ` · ${receiptCount} receipt${receiptCount === 1 ? "" : "s"} saved` : ""
      }</p>
    <p style="margin:0 0 12px;">📊 <a href="${sheetUrl}" style="color:#2563eb;">Open the completed expense sheet</a></p>
    ${photosBlock}
    <p style="margin:24px 0 0;color:#94a3b8;font-size:12px;">Sent automatically by Doona — your AI trip-expense assistant.</p>
  </div>
</body></html>`;
      const textBody = `Your Doona expense report — ${sheetTitle}\n\nSpreadsheet: ${sheetUrl}\n${
        folderUrl ? `Photos folder: ${folderUrl}\n` : ""
      }`;

      // RFC 2822 multipart message (text + html)
      const boundary = `doona_${crypto.randomUUID()}`;
      const raw = [
        `To: ${userEmail}`,
        `Subject: ${encodeMimeHeader(subject)}`,
        `MIME-Version: 1.0`,
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        ``,
        `--${boundary}`,
        `Content-Type: text/plain; charset="UTF-8"`,
        `Content-Transfer-Encoding: 7bit`,
        ``,
        textBody,
        ``,
        `--${boundary}`,
        `Content-Type: text/html; charset="UTF-8"`,
        `Content-Transfer-Encoding: 7bit`,
        ``,
        html,
        ``,
        `--${boundary}--`,
      ].join("\r\n");

      const b64 = base64UrlEncode(raw);
      const sendResp = await fetch(`${GMAIL_GATEWAY}/users/me/messages/send`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "X-Connection-Api-Key": GOOGLE_MAIL_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw: b64 }),
      });
      if (!sendResp.ok) {
        const t = await sendResp.text();
        return jsonErr(`Email send failed [${sendResp.status}]: ${t}`, 500);
      }
      return ok({ sent: true });
    }

    return jsonErr("Unknown mode", 400);
  } catch (e) {
    console.error("scan-receipt error:", e);
    return jsonErr(e instanceof Error ? e.message : "Unknown error", 500);
  }
});

// ─── helpers ────────────────────────────────────────────────────────────

function ok(data: unknown) {
  return new Response(JSON.stringify({ success: true, ...((data as object) || {}) }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function jsonErr(error: string, status: number) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function cellWrite(sheetId: number, rowIdx: number, colIdx: number, value: string | number) {
  const userEnteredValue =
    typeof value === "number"
      ? { numberValue: value }
      : { stringValue: String(value) };
  return {
    updateCells: {
      rows: [{ values: [{ userEnteredValue }] }],
      fields: "userEnteredValue",
      start: { sheetId, rowIndex: rowIdx, columnIndex: colIdx },
    },
  };
}

function linkWrite(sheetId: number, rowIdx: number, colIdx: number, url: string, label: string) {
  return {
    updateCells: {
      rows: [{
        values: [{
          userEnteredValue: { formulaValue: `=HYPERLINK("${url.replace(/"/g, '""')}","${label}")` },
        }],
      }],
      fields: "userEnteredValue",
      start: { sheetId, rowIndex: rowIdx, columnIndex: colIdx },
    },
  };
}

function calcBusinessDays(from: string, to: string): number {
  const start = new Date(from);
  const end = new Date(to);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return 0;
  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const d = cur.getUTCDay(); // 0=Sun, 6=Sat
    if (d !== 5 && d !== 6) count++; // exclude Fri+Sat (Israeli weekend)
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}

// Write an ILS-converted amount in column G. If currency is already ILS,
// just mirror column F. Otherwise use GOOGLEFINANCE for live FX rates,
// falling back gracefully if the rate isn't available.
function ilsFormulaWrite(sheetId: number, rowIdx: number, colIdx: number, rowNumber: number, currency: string) {
  const cur = (currency || "").toUpperCase();
  let formula: string;
  if (cur === "ILS") {
    formula = `=F${rowNumber}`;
  } else {
    const fxCur = cur === "RMB" ? "CNY" : cur;
    formula = `=IFERROR(F${rowNumber}*INDEX(GOOGLEFINANCE("CURRENCY:${fxCur}ILS","price",C${rowNumber}),2,2),IFERROR(F${rowNumber}*GOOGLEFINANCE("CURRENCY:${fxCur}ILS"),F${rowNumber}))`;
  }
  return {
    updateCells: {
      rows: [{ values: [{ userEnteredValue: { formulaValue: formula } }] }],
      fields: "userEnteredValue",
      start: { sheetId, rowIndex: rowIdx, columnIndex: colIdx },
    },
  };
}

async function loadSections(headers: HeadersInit, sheetId: number): Promise<Section[]> {
  const url = `${SHEETS_GATEWAY}/spreadsheets/${SPREADSHEET_ID}/values:batchGetByDataFilter`;
  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      dataFilters: [{ gridRange: { sheetId, startRowIndex: 0, endRowIndex: 220, startColumnIndex: 0, endColumnIndex: 8 } }],
      valueRenderOption: "FORMATTED_VALUE",
    }),
  });
  if (!resp.ok) throw new Error(`Load sections failed [${resp.status}]: ${await resp.text()}`);
  const j = await resp.json();
  const rows: string[][] = j.valueRanges?.[0]?.valueRange?.values || [];
  const sections: Section[] = [];
  for (let i = 0; i < rows.length; i++) {
    const cellC = (rows[i]?.[2] || "").trim();
    if (cellC === "תאריך") {
      const titleCell = (rows[i - 1]?.[2] || rows[i - 1]?.[1] || "").trim();
      const title = CATEGORIES.find((c) => titleCell === c) || titleCell;
      let end = i + 1;
      while (end < rows.length) {
        const f = rows[end]?.[5] || "";
        if (f.includes("סה\"כ")) break;
        end++;
      }
      sections.push({
        title,
        header_row: i + 1,
        first_data_row: i + 2,
        last_data_row: end, // exclusive of the totals row, inclusive of last data row
      });
    }
  }
  return sections;
}

async function readSectionDates(headers: HeadersInit, sheetId: number, s: Section): Promise<string[]> {
  const url = `${SHEETS_GATEWAY}/spreadsheets/${SPREADSHEET_ID}/values:batchGetByDataFilter`;
  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      dataFilters: [{
        gridRange: {
          sheetId,
          startRowIndex: s.first_data_row - 1,
          endRowIndex: s.last_data_row,
          startColumnIndex: 2,
          endColumnIndex: 3,
        },
      }],
      valueRenderOption: "FORMATTED_VALUE",
    }),
  });
  const j = await resp.json();
  const rows: string[][] = j.valueRanges?.[0]?.valueRange?.values || [];
  const out: string[] = [];
  const total = s.last_data_row - (s.first_data_row - 1);
  for (let i = 0; i < total; i++) {
    out.push((rows[i]?.[0] || "").trim());
  }
  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function encodeMimeHeader(s: string): string {
  // RFC 2047 encoded-word for non-ASCII subject lines.
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  const b64 = btoa(unescape(encodeURIComponent(s)));
  return `=?UTF-8?B?${b64}?=`;
}

function base64UrlEncode(s: string): string {
  // UTF-8 safe base64url encoding.
  const b64 = btoa(unescape(encodeURIComponent(s)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Quote a sheet title for use inside an A1-notation formula reference.
// Wrap in single quotes and escape any embedded single quotes.
function quoteSheetTitle(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

// Rewrite the summary tab's per-category SUMIFS formulas (C18:C26) so they
// reference the freshly-created trip tab instead of the stale hardcoded one
// that was baked into the master template.
async function rewriteSummaryFormulas(headers: HeadersInit, tripSheetTitle: string) {
  const q = quoteSheetTitle(tripSheetTitle);
  const formulas: string[][] = [];
  // Rows 18..26 → categories listed in column B of the summary tab.
  for (let r = 18; r <= 26; r++) {
    formulas.push([`=SUMIFS(${q}!G:G,${q}!B:B,B${r})`]);
  }
  const range = `${quoteSheetTitle(SUMMARY_SHEET_TITLE)}!C18:C26`;
  const url = `${SHEETS_GATEWAY}/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
  const resp = await fetch(url, {
    method: "PUT",
    headers,
    body: JSON.stringify({ range, majorDimension: "ROWS", values: formulas }),
  });
  if (!resp.ok) throw new Error(`Summary rewrite failed [${resp.status}]: ${await resp.text()}`);
}

// Append a single receipt row to the RAW tab. Header order (row 1):
//   A date | B category | C amount | D currency | E description |
//   F payment_method | G city | H country | I filename | J drive_url |
//   K raw_text | L אסמכתא (hyperlink to receipt)
async function appendRawRow(
  headers: HeadersInit,
  r: {
    date: string; category: string; amount: number; currency: string;
    description: string; payment_method: string; city: string; country: string;
    filename: string; drive_url: string; raw_text: string;
  },
) {
  const link = r.drive_url
    ? `=HYPERLINK("${r.drive_url.replace(/"/g, '""')}","קבלה")`
    : "";
  const row = [
    r.date, r.category, r.amount, r.currency, r.description,
    r.payment_method, r.city, r.country, r.filename, r.drive_url,
    r.raw_text, link,
  ];
  const range = `${RAW_SHEET_TITLE}!A1`;
  const url = `${SHEETS_GATEWAY}/spreadsheets/${SPREADSHEET_ID}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ range, majorDimension: "ROWS", values: [row] }),
  });
  if (!resp.ok) throw new Error(`RAW append failed [${resp.status}]: ${await resp.text()}`);
}
