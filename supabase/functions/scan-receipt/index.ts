import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const SHEETS_GATEWAY = "https://connector-gateway.lovable.dev/google_sheets/v4";
const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const GOOGLE_SHEETS_API_KEY = Deno.env.get("GOOGLE_SHEETS_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");
    if (!GOOGLE_SHEETS_API_KEY) throw new Error("GOOGLE_SHEETS_API_KEY not configured");

    const { imageBase64, mimeType, spreadsheetId, sheetName } = await req.json();
    if (!imageBase64) throw new Error("imageBase64 required");
    if (!spreadsheetId) throw new Error("spreadsheetId required");

    // 1. AI extraction via tool calling for structured output
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
              "You extract structured receipt data from images. Always call the extract_receipt tool. If a field is unclear, use an empty string. Date must be ISO format YYYY-MM-DD. Currency must be ISO 4217 code (e.g. USD, EUR, GBP). Total must be a number with no currency symbol.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Extract the receipt fields from this image." },
              { type: "image_url", image_url: { url: `data:${mimeType || "image/jpeg"};base64,${imageBase64}` } },
            ],
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_receipt",
              description: "Return extracted receipt fields.",
              parameters: {
                type: "object",
                properties: {
                  date: { type: "string", description: "YYYY-MM-DD" },
                  merchant: { type: "string" },
                  currency: { type: "string", description: "ISO 4217 code" },
                  total: { type: "number" },
                },
                required: ["date", "merchant", "currency", "total"],
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
        return new Response(JSON.stringify({ error: "Rate limit reached. Please try again shortly." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      if (aiResp.status === 402)
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Add funds in Settings → Workspace → Usage." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      throw new Error(`AI error [${aiResp.status}]: ${t}`);
    }

    const aiJson = await aiResp.json();
    const toolCall = aiJson.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("AI did not return structured data");
    const extracted = JSON.parse(toolCall.function.arguments);

    // 2. Append to Google Sheet
    const sheet = sheetName || "Sheet1";
    const range = `${sheet}!A:E`;
    const sheetsResp = await fetch(
      `${SHEETS_GATEWAY}/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "X-Connection-Api-Key": GOOGLE_SHEETS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          values: [[
            extracted.date || "",
            extracted.merchant || "",
            extracted.currency || "",
            extracted.total ?? "",
            new Date().toISOString(),
          ]],
        }),
      },
    );

    if (!sheetsResp.ok) {
      const t = await sheetsResp.text();
      throw new Error(`Google Sheets error [${sheetsResp.status}]: ${t}`);
    }

    return new Response(JSON.stringify({ success: true, extracted }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("scan-receipt error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
