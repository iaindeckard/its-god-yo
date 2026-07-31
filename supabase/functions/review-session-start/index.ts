import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// Start a review session. Input: { reviewer_id }.
// Inserts a review_sessions row (started_at defaults to now()) and returns
// its id. The reviewer threads this id into subsequent review-reject-verse
// calls so that review-session-end can enforce the locked rule: any slot
// rejected during THIS session must reach an approved/sent state before the
// session can be ended cleanly.
//
// No external AI calls -- free to run. reviewer_id is derived from the caller's
// verified JWT (has_permission('content.queue.view')), not a body parameter.

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

  // No body fields are required — reviewer_id is derived from the authenticated
  // JWT (below), so the request body is not parsed.

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
    p_permission_key: "content.queue.view",
  });
  if (permErr) return json(500, { error: "permission_check_failed", detail: permErr.message });
  if (allowed !== true) return json(403, { error: "forbidden", detail: "missing permission 'content.queue.view'" });
  const reviewer_id = user.id;

  const { data: session, error: insertErr } = await supa
    .from("review_sessions")
    .insert({ reviewer_id })
    .select("id, reviewer_id, started_at")
    .single();
  if (insertErr || !session) return json(500, { error: "failed_to_create_session", detail: insertErr?.message });

  return json(200, {
    status: "session_started",
    review_session_id: session.id,
    reviewer_id: session.reviewer_id,
    started_at: session.started_at,
  });
});
