import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// Approve the SPANISH dimension of a daily_slot: reviewer picks AI output A or
// B as the Spanish final. Mirrors review-approve exactly but writes the _es
// columns. No used_verses insert here -- verse_ref is shared with the English
// row and the dedup log is already written when the English side is approved;
// approving the Spanish translation doesn't consume a new verse.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  let body: { daily_slot_id?: string; chosen_output?: "a" | "b" };
  try { body = await req.json(); } catch { return json(400, { error: "invalid_json_body" }); }

  const { daily_slot_id, chosen_output } = body;
  if (!daily_slot_id || !chosen_output) {
    return json(400, { error: "daily_slot_id and chosen_output ('a' or 'b') are required" });
  }
  if (chosen_output !== "a" && chosen_output !== "b") {
    return json(400, { error: "chosen_output must be 'a' or 'b'" });
  }

  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return json(401, { error: "unauthorized" });
  const { data: allowed, error: permErr } = await supa.rpc("has_permission", {
    p_user_id: user.id,
    p_permission_key: "content.queue.approve",
  });
  if (permErr) return json(500, { error: "permission_check_failed", detail: permErr.message });
  if (allowed !== true) return json(403, { error: "forbidden", detail: "missing permission 'content.queue.approve'" });
  const reviewer_id = user.id;

  const { data: slot, error: fetchErr } = await supa.from("daily_slots").select("*").eq("id", daily_slot_id).single();
  if (fetchErr || !slot) return json(404, { error: "daily_slot_not_found" });
  if (slot.status_es === "approved" || slot.status_es === "sent") {
    return json(409, { error: "already_resolved", detail: `status_es is already '${slot.status_es}'` });
  }

  const finalTranslation = chosen_output === "a" ? slot.ai_output_a_es : slot.ai_output_b_es;
  if (!finalTranslation) return json(500, { error: "chosen_output_missing", detail: `ai_output_${chosen_output}_es is empty on this slot` });

  const { data: updated, error: updateErr } = await supa
    .from("daily_slots")
    .update({
      status_es: "approved",
      final_translation_es: finalTranslation,
      approved_by_es: reviewer_id,
      approved_at_es: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", daily_slot_id)
    .select().single();
  if (updateErr) return json(500, { error: "failed_to_update_slot", detail: updateErr.message });

  return json(200, { status: "approved", slot: updated });
});
