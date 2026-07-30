import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// Approve a daily_slot: reviewer picks AI output A or B as final. No new AI
// calls, no cost. Writes used_verses at THIS point (approval), not at
// generation time -- so a verse that gets generated but never approved never
// counts against the 12-month dedup window.
//
// NOTE ON AUTH: reviewer_id is currently just an accepted UUID parameter,
// not tied to a real authenticated session or checked against
// staff_job_roles/role_permissions. That enforcement layer doesn't exist
// yet -- this function trusts whatever caller invokes it. Fine for internal
// testing, a real gap before any non-Iain reviewer uses this for real.

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

  let body: { daily_slot_id?: string; chosen_output?: "a" | "b"; reviewer_id?: string };
  try { body = await req.json(); } catch { return json(400, { error: "invalid_json_body" }); }

  const { daily_slot_id, chosen_output, reviewer_id } = body;
  if (!daily_slot_id || !chosen_output || !reviewer_id) {
    return json(400, { error: "daily_slot_id, chosen_output ('a' or 'b'), and reviewer_id are all required" });
  }
  if (chosen_output !== "a" && chosen_output !== "b") {
    return json(400, { error: "chosen_output must be 'a' or 'b'" });
  }

  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  const { data: slot, error: fetchErr } = await supa.from("daily_slots").select("*").eq("id", daily_slot_id).single();
  if (fetchErr || !slot) return json(404, { error: "daily_slot_not_found" });
  if (slot.status === "approved" || slot.status === "sent") {
    return json(409, { error: "already_resolved", detail: `slot status is already '${slot.status}'` });
  }

  const finalTranslation = chosen_output === "a" ? slot.ai_output_a : slot.ai_output_b;
  if (!finalTranslation) return json(500, { error: "chosen_output_missing", detail: `ai_output_${chosen_output} is empty on this slot` });

  const { data: updated, error: updateErr } = await supa
    .from("daily_slots")
    .update({
      status: "approved",
      final_translation: finalTranslation,
      approved_by: reviewer_id,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", daily_slot_id)
    .select().single();
  if (updateErr) return json(500, { error: "failed_to_update_slot", detail: updateErr.message });

  const { error: usedErr } = await supa.from("used_verses").insert({ verse_ref: slot.verse_ref, used_for_date: slot.scheduled_date });
  if (usedErr) return json(500, { error: "slot_approved_but_dedup_log_failed", detail: usedErr.message, slot: updated });

  return json(200, { status: "approved", slot: updated });
});
