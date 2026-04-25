import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const SHEETS_GATEWAY = "https://connector-gateway.lovable.dev/google_sheets/v4";
const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

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
const CURRENCIES = ["ILS", "USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD"];
const PAYMENT_METHODS = ["Corporate Card", "Personal Card", "Cash"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const GOOGLE_SHEETS_API_KEY = Deno.env.get("GOOGLE_SHEETS_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");
    if (!GOOGLE_SHEETS_API_KEY) throw new Error("GOOGLE_SHEETS_API_KEY not configured");

    const body = await req.json();
    const { mode } = body;

    // === MODE 1: extract only ===
    if (mode === "extract") {
      const { imageBase64, mimeType } = body;
      if (!imageBase64) throw new Error("imageBase64 required");

      const aiResp = await fetch(AI_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content:
                "You extract structured business expense data from receipt images. Always call extract_receipt. Rules: " +
                "date must be YYYY-MM-DD; " +
                "currency must be ISO 4217 (e.g. ILS, USD, EUR); " +
                `category MUST be one of exactly: ${CATEGORIES.join(" | ")} — pick the closest match; ` +
                `payment_method MUST be one of: ${PAYMENT_METHODS.join(" | ")} (default to "Corporate Card" if unclear); ` +
                "amount is a number with no currency symbol; " +
                "description is a short summary (max 80 chars); " +
                "city and country in English; " +
                "raw_text is the full text visible on the receipt; " +
                "leave empty string if a field truly cannot be determined.",
            },
            {
              role: "user",
              content: [
                { type: "text", text: "Extract all fields from this receipt." },
                {
                  type: "image_url",
                  image_url: { url: `data:${mimeType || "image/jpeg"};base64,${imageBase64}` },
                },
              ],
            },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "extract_receipt",
                description: "Return structured receipt fields.",
                parameters: {
                  type: "object",
                  properties: {
                    date: { type: "string" },
                    category: { type: "string", enum: CATEGORIES },
                    amount: { type: "number" },
                    currency: { type: "string", enum: CURRENCIES },
                    description: { type: "string" },
                    payment_method: { type: "string", enum: PAYMENT_METHODS },
                    city: { type: "string" },
                    country: { type: "string" },
                    raw_text: { type: "string" },
                  },
                  required: [
                    "date",
                    "category",
                    "amount",
                    "currency",
                    "description",
                    "payment_method",
                    "city",
                    "country",
                    "raw_text",
                  ],
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: { type: "function", function: { name: "extract_receipt" } },
        }),
      });

      if (!aiResp.ok) {
        const t = await aiResp.text();
        if (aiResp.status === 429)
          return jsonErr("Rate limit reached. Please try again shortly.", 429);
        if (aiResp.status === 402)
          return jsonErr("AI credits exhausted. Add funds in Settings → Workspace → Usage.", 402);
        throw new Error(`AI error [${aiResp.status}]: ${t}`);
      }
      const aiJson = await aiResp.json();
      const toolCall = aiJson.choices?.[0]?.message?.tool_calls?.[0];
      if (!toolCall) throw new Error("AI did not return structured data");
      const extracted = JSON.parse(toolCall.function.arguments);
      return new Response(JSON.stringify({ success: true, extracted }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // === MODE 2: append validated row to RAW sheet ===
    if (mode === "append") {
      const { spreadsheetId, row } = body;
      if (!spreadsheetId) throw new Error("spreadsheetId required");
      if (!row) throw new Error("row required");

      // Server-side validation — reject anything that doesn't fit the locked schema
      const errors: string[] = [];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date || "")) errors.push("date must be YYYY-MM-DD");
      if (!CATEGORIES.includes(row.category)) errors.push("invalid category");
      if (!CURRENCIES.includes(row.currency)) errors.push("invalid currency");
      if (!PAYMENT_METHODS.includes(row.payment_method)) errors.push("invalid payment method");
      const amountNum = Number(row.amount);
      if (!isFinite(amountNum) || amountNum <= 0) errors.push("amount must be a positive number");
      if (!row.description?.trim()) errors.push("description required");
      if (errors.length) return jsonErr("Validation failed: " + errors.join(", "), 400);

      // RAW columns: date | category | amount | currency | description | payment_method | city | country | filename | drive_url | raw_text | אסמכתא
      const values = [[
        row.date,
        row.category,
        amountNum,
        row.currency,
        row.description.trim(),
        row.payment_method,
        row.city || "",
        row.country || "",
        row.filename || "",
        row.drive_url || "",
        row.raw_text || "",
        row.drive_url || "", // אסמכתא = reference link to receipt
      ]];

      const range = "RAW!A:L";
      const url = `${SHEETS_GATEWAY}/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
      const sheetsResp = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "X-Connection-Api-Key": GOOGLE_SHEETS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ values }),
      });

      if (!sheetsResp.ok) {
        const t = await sheetsResp.text();
        throw new Error(`Google Sheets error [${sheetsResp.status}]: ${t}`);
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // === MODE 3: return allowed enums for UI ===
    if (mode === "options") {
      return new Response(
        JSON.stringify({ categories: CATEGORIES, currencies: CURRENCIES, payment_methods: PAYMENT_METHODS }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return jsonErr("Unknown mode", 400);
  } catch (e) {
    console.error("scan-receipt error:", e);
    return jsonErr(e instanceof Error ? e.message : "Unknown error", 500);
  }
});

function jsonErr(error: string, status: number) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
