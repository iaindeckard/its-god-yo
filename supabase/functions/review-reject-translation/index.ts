import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// Reject/edit the TRANSLATION only -- verse is fine, both AI attempts
// weren't. Reviewer supplies the final text directly. No regeneration, no
// new AI calls, no cost. Logs both original AI outputs (not just one) to
// corrections_log so the entry is actually useful as a future few-shot
// example -- the whole point of the log is real examples of what was wrong
// and what a human preferred instead.

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

  let body: { daily_slot_id?: string; reviewer_id?: string; corrected_translation?: string; reason?: string };
  try { body = await req.json(); } catch { return json(400, { error: "invalid_json_body" }); }

  const { daily_slot_id, corrected_translation, reason } = body;
  if (!daily_slot_id || !corrected_translation || !reason) {
    return json(400, { error: "daily_slot_id, corrected_translation, and reason are all required" });
  }

  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  // ── AUTH (added 2026-07-30): require an authenticated staff member with the
  // right permission. Defense-in-depth — the Next.js admin route also gates
  // this, but this function is publicly reachable (the anon key is public), so
  // it enforces its own check instead of trusting the caller. reviewer_id is
  // derived from the verified JWT, never taken from the request body. ──
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
    p_permission_key: "content.queue.reject_translation",
  });
  if (permErr) return json(500, { error: "permission_check_failed", detail: permErr.message });
  if (allowed !== true) return json(403, { error: "forbidden", detail: "missing permission 'content.queue.reject_translation'" });
  const reviewer_id = user.id;

  const { data: slot, error: fetchErr } = await supa.from("daily_slots").select("*").eq("id", daily_slot_id).single();
  if (fetchErr || !slot) return json(404, { error: "daily_slot_not_found" });
  if (slot.status === "approved" || slot.status === "sent") {
    return json(409, { error: "already_resolved", detail: `slot status is already '${slot.status}'` });
  }

  const { error: logErr } = await supa.from("corrections_log").insert({
    daily_slot_id,
    action_type: "reject_translation",
    original_verse_ref: slot.verse_ref,
    original_translation: `AI-A (claude-sonnet-4-6): ${slot.ai_output_a ?? "(none)"}\nAI-B (gpt-4o): ${slot.ai_output_b ?? "(none)"}`,
    corrected_translation,
    reason,
    corrected_by: reviewer_id,
  });
  if (logErr) return json(500, { error: "failed_to_log_correction", detail: logErr.message });

  const { data: updated, error: updateErr } = await supa
    .from("daily_slots")
    .update({
      status: "approved",
      final_translation: corrected_translation,
      approved_by: reviewer_id,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", daily_slot_id)
    .select().single();
  if (updateErr) return json(500, { error: "failed_to_update_slot", detail: updateErr.message });

  const { error: usedErr } = await supa.from("used_verses").insert({ verse_ref: slot.verse_ref, used_for_date: slot.scheduled_date });
  if (usedErr) return json(500, { error: "slot_approved_but_dedup_log_failed", detail: usedErr.message, slot: updated });

  return json(200, { status: "translation_corrected_and_approved", slot: updated });
});
