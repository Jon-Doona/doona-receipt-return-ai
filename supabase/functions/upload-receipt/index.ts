import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const BUCKET = "receipts";

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);
// 10 MB cap on the decoded image
const MAX_BYTES = 10 * 1024 * 1024;
// Long-lived signed URL so the spreadsheet HYPERLINK keeps working.
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 365;

function sanitize(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json();
    const { imageBase64, mimeType, filename, tripId } = body ?? {};
    if (!imageBase64 || !filename) {
      return new Response(JSON.stringify({ error: "imageBase64 and filename are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const contentType = (mimeType || "image/jpeg").toLowerCase();
    if (!ALLOWED_MIME.has(contentType)) {
      return new Response(JSON.stringify({ error: "Unsupported image type" }), {
        status: 415,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const bytes = Uint8Array.from(atob(imageBase64), (c) => c.charCodeAt(0));
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) {
      return new Response(JSON.stringify({ error: "Image is empty or exceeds 10MB limit" }), {
        status: 413,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const safeTrip = sanitize(tripId || "untagged");
    const path = `${safeTrip}/${crypto.randomUUID()}-${sanitize(filename)}`;

    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, bytes, {
      contentType,
      upsert: false,
    });
    if (upErr) throw upErr;

    const { data: signed, error: signErr } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (signErr || !signed?.signedUrl) throw signErr ?? new Error("Failed to sign URL");
    return new Response(
      JSON.stringify({ publicUrl: signed.signedUrl, path, bucket: BUCKET }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});