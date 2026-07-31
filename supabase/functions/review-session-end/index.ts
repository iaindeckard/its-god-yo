import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// End a review session. Input: { review_session_id, notes? }.
//
// Locked product rule: a reviewer must resolve (reach an approved/sent state
// for) any slot they rejected via review-reject-verse DURING THIS SESSION
// before formally ending it. If they end the session while any such slot is
// still unresolved, each unresolved slot escalates to super_admin.
//
// Crucially, "unresolved" is scoped to reject_verse actions stamped with THIS
// session id -- NOT the whole review queue. A month is generated at once and
// most slots are never touched in a given session; that is normal and does
// NOT block a clean end. reject_translation never creates unresolved state
// (it resolves to approved in one step) and so is not considered here.
//
// No external AI calls -- free to run and test fully.
//
// NOTE (out of scope, intentionally not built): the product spec mentions an
// idle-session auto-close backstop "in case someone just closes the tab."
// That would be a scheduled job that finds review_sessions with ended_at IS
// NULL and started_at older than some threshold, then calls this same
// end-of-session logic. It is deliberately NOT wired up here -- unattended
// automation is a separate decision.

const RESOLVED_STATUSES = new Set(["approved", "sent"]);

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

  let body: { review_session_id?: string; notes?: string };
  try { body = await req.json(); } catch { return json(400, { error: "invalid_json_body" }); }

  const { review_session_id, notes } = body;
  if (!review_session_id) return json(400, { error: "review_session_id is required" });

  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  // ── AUTH (added 2026-07-30): require an authenticated staff member with the
  // right permission. Defense-in-depth — the Next.js admin route also gates
  // this, but this function is publicly reachable (the anon key is public), so
  // it enforces its own check instead of trusting the caller. Escalation
  // attribution still uses the session's own reviewer_id (loaded below). ──
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
    p_permission_key: "content.queue.view",
  });
  if (permErr) return json(500, { error: "permission_check_failed", detail: permErr.message });
  if (allowed !== true) return json(403, { error: "forbidden", detail: "missing permission 'content.queue.view'" });

  // Load the session -- we need its reviewer_id for escalation rows, and we
  // must not double-end an already-ended session (that would re-escalate).
  const { data: session, error: sessErr } = await supa
    .from("review_sessions").select("id, reviewer_id, ended_at").eq("id", review_session_id).single();
  if (sessErr || !session) return json(404, { error: "review_session_not_found" });
  if (session.ended_at) return json(409, { error: "session_already_ended", detail: `ended_at is already '${session.ended_at}'` });

  // Which slots did this reviewer reject during THIS session? (dedup: a slot
  // may have been rejected more than once in the same session.)
  const { data: rejectRows, error: logErr } = await supa
    .from("corrections_log")
    .select("daily_slot_id")
    .eq("review_session_id", review_session_id)
    .eq("action_type", "reject_verse");
  if (logErr) return json(500, { error: "failed_to_read_corrections_log", detail: logErr.message });

  const rejectedSlotIds = [...new Set((rejectRows || []).map((r: { daily_slot_id: string }) => r.daily_slot_id))];

  // Of those, which are still unresolved (not approved/sent right now)?
  let unresolvedSlotIds: string[] = [];
  if (rejectedSlotIds.length > 0) {
    const { data: slots, error: slotsErr } = await supa
      .from("daily_slots").select("id, status").in("id", rejectedSlotIds);
    if (slotsErr) return json(500, { error: "failed_to_read_daily_slots", detail: slotsErr.message });
    unresolvedSlotIds = (slots || [])
      .filter((s: { status: string }) => !RESOLVED_STATUSES.has(s.status))
      .map((s: { id: string }) => s.id);
  }

  const endedCleanly = unresolvedSlotIds.length === 0;

  // Escalate each unresolved slot to super_admin.
  if (!endedCleanly) {
    const escalationRows = unresolvedSlotIds.map((slotId) => ({
      daily_slot_id: slotId,
      review_session_id,
      reviewer_id: session.reviewer_id,
    }));
    const { error: escErr } = await supa.from("escalations").insert(escalationRows);
    if (escErr) return json(500, { error: "failed_to_create_escalations", detail: escErr.message });
  }

  // Close out the session. Only overwrite notes when provided.
  const updatePayload: { ended_at: string; ended_cleanly: boolean; notes?: string } = {
    ended_at: new Date().toISOString(),
    ended_cleanly: endedCleanly,
  };
  if (notes !== undefined) updatePayload.notes = notes;

  const { error: updErr } = await supa.from("review_sessions").update(updatePayload).eq("id", review_session_id);
  if (updErr) return json(500, { error: "failed_to_end_session", detail: updErr.message });

  return json(200, {
    status: "session_ended",
    ended_cleanly: endedCleanly,
    escalated_slot_ids: unresolvedSlotIds,
  });
});
