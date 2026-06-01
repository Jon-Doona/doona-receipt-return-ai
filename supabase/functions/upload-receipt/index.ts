import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const BUCKET = "receipts";

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

    const bytes = Uint8Array.from(atob(imageBase64), (c) => c.charCodeAt(0));
    const safeTrip = sanitize(tripId || "untagged");
    const path = `${safeTrip}/${crypto.randomUUID()}-${sanitize(filename)}`;

    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, bytes, {
      contentType: mimeType || "image/jpeg",
      upsert: false,
    });
    if (upErr) throw upErr;

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return new Response(
      JSON.stringify({ publicUrl: data.publicUrl, path, bucket: BUCKET }),
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