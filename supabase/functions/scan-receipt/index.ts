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
const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

const SPREADSHEET_ID = "1Lyr3ghfgaBLM7Sdoz6v5mRbuENxGC2zw9XjVwskJQl8";
const TEMPLATE_SHEET_ID = 412908812; // "דוח החזר"

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
      const { imageBase64, filename, userEmail, mimeType } = body;
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
      const { sheetId } = body;
      if (sheetId === undefined || sheetId === null) return jsonErr("sheetId required", 400);
      const resp = await fetch(
        `${SHEETS_GATEWAY}/spreadsheets/${SPREADSHEET_ID}?fields=sheets.properties.sheetId`,
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
      const { traveler_name, role, country, purpose, from_date, to_date, itinerary } = body;
      if (!traveler_name?.trim()) return jsonErr("traveler_name required", 400);
      if (!country?.trim()) return jsonErr("country required", 400);
      if (!from_date || !to_date) return jsonErr("from_date / to_date required", 400);

      // Auto-calculate business days (Mon-Fri count, inclusive) from the date range.
      // Falls back to total inclusive day count if parsing fails.
      const business_days = calcBusinessDays(from_date, to_date);

      const tabTitle =
        `${traveler_name.trim()} – ${country.trim()} – ${from_date}`
          .slice(0, 90)
          .replace(/[\\\/\?\*\[\]]/g, "-");

      // 1. Duplicate the template sheet
      const dupResp = await fetch(
        `${SHEETS_GATEWAY}/spreadsheets/${SPREADSHEET_ID}:batchUpdate`,
        {
          method: "POST",
          headers: sheetsHeaders,
          body: JSON.stringify({
            requests: [{
              duplicateSheet: {
                sourceSheetId: TEMPLATE_SHEET_ID,
                newSheetName: tabTitle,
                insertSheetIndex: 2,
              },
            }],
          }),
        },
      );
      if (!dupResp.ok) throw new Error(`Duplicate sheet failed [${dupResp.status}]: ${await dupResp.text()}`);
      const dupJson = await dupResp.json();
      const newSheetId: number = dupJson.replies[0].duplicateSheet.properties.sheetId;
      const newSheetTitle: string = dupJson.replies[0].duplicateSheet.properties.title;

      // 2. Read the new sheet's content so we can compute section ranges
      const sections = await loadSections(sheetsHeaders, newSheetId);

      // 3. Fill header fields + itinerary in one batchUpdate using updateCells (sheetId-based, no range parsing)
      const headerRequests = [
        // Header (RTL form layout: data sits in column D = index 3, row indexes are 0-based)
        cellWrite(newSheetId, 6, 3, traveler_name.trim()),         // C7 שם + משפחה  → value column D (index 3) row 7
        cellWrite(newSheetId, 7, 3, role || ""),                   // C8 תפקיד
        cellWrite(newSheetId, 10, 2, country.trim()),               // מדינה (col C)
        cellWrite(newSheetId, 10, 3, purpose || ""),                // מטרת הנסיעה (col D)
        cellWrite(newSheetId, 10, 4, from_date),                    // מיום (col E)
        cellWrite(newSheetId, 10, 5, to_date),                      // עד יום (col F)
        cellWrite(newSheetId, 10, 6, business_days || ""),         // ימי שהייה (col G)
      ];

      // Itinerary rows (row 11-13 in template = rows 11,12,13 are empty under destinations header)
      // Itinerary header was at row 10 so destinations go at rows 11,12,13...
      // We'll write up to 5 destinations starting at row 11
      if (Array.isArray(itinerary)) {
        itinerary.slice(0, 5).forEach((it: any, i: number) => {
          const rowIdx = 10 + i; // row 11 = index 10
          headerRequests.push(cellWrite(newSheetId, rowIdx, 2, it.destination || ""));
          headerRequests.push(cellWrite(newSheetId, rowIdx, 3, it.from || ""));
          headerRequests.push(cellWrite(newSheetId, rowIdx, 4, it.to || ""));
        });
      }

      const updResp = await fetch(
        `${SHEETS_GATEWAY}/spreadsheets/${SPREADSHEET_ID}:batchUpdate`,
        {
          method: "POST",
          headers: sheetsHeaders,
          body: JSON.stringify({ requests: headerRequests }),
        },
      );
      if (!updResp.ok) throw new Error(`Header write failed [${updResp.status}]: ${await updResp.text()}`);

      return ok({
        spreadsheetId: SPREADSHEET_ID,
        sheetId: newSheetId,
        sheetTitle: newSheetTitle,
        sheetUrl: `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit#gid=${newSheetId}`,
        sections,
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

      // Re-read sections for THIS sheet (cheap and resilient if user edited the sheet)
      const sections = await loadSections(sheetsHeaders, sheetId);
      const section = sections.find((s) => s.title === receipt.category);
      if (!section) return jsonErr(`Category section "${receipt.category}" not found in sheet`, 400);

      // Find next empty data row in the section by checking col C (date column)
      const dataValues = await readSectionDates(sheetsHeaders, sheetId, section);
      let targetOffset = -1;
      for (let i = 0; i < dataValues.length; i++) {
        if (!dataValues[i]) { targetOffset = i; break; }
      }
      if (targetOffset === -1) {
        // Section is full — insert a new empty row at the bottom of the section
        // (just before the totals row) so the receipt can be written.
        const insertAtRowIdx = section.last_data_row; // 0-based index = last_data_row (1-based) → inserts before totals
        const insertResp = await fetch(
          `${SHEETS_GATEWAY}/spreadsheets/${SPREADSHEET_ID}:batchUpdate`,
          {
            method: "POST",
            headers: sheetsHeaders,
            body: JSON.stringify({
              requests: [{
                insertDimension: {
                  range: {
                    sheetId,
                    dimension: "ROWS",
                    startIndex: insertAtRowIdx,
                    endIndex: insertAtRowIdx + 1,
                  },
                  inheritFromBefore: true,
                },
              }],
            }),
          },
        );
        if (!insertResp.ok) {
          throw new Error(`Auto-expand section failed [${insertResp.status}]: ${await insertResp.text()}`);
        }
        targetOffset = dataValues.length; // append to the new row at the end
        section.last_data_row += 1;
      }
      const targetRow = section.first_data_row + targetOffset; // 1-based
      const rowIdx = targetRow - 1;

      // Form columns (1-based / 0-based): C=date(2) D=destination(3) E=currency(4) F=amount(5) H=paid_by(7) I=ref(8)
      const requests: any[] = [
        cellWrite(sheetId, rowIdx, 2, receipt.date),
        cellWrite(sheetId, rowIdx, 3, receipt.destination || ""),
        cellWrite(sheetId, rowIdx, 4, receipt.currency),
        cellWrite(sheetId, rowIdx, 5, amount),
        cellWrite(sheetId, rowIdx, 7, PAYMENT_METHODS_HE[receipt.payment_method]),
      ];
      if (receipt.drive_url) {
        requests.push(linkWrite(sheetId, rowIdx, 8, receipt.drive_url, "קבלה"));
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

      return ok({ row: targetRow, section: section.title });
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
