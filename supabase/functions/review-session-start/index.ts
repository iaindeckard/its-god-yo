import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// Start a review session. Input: { reviewer_id }.
// Inserts a review_sessions row (started_at defaults to now()) and returns
// its id. The reviewer threads this id into subsequent review-reject-verse
// calls so that review-session-end can enforce the locked rule: any slot
// rejected during THIS session must reach an approved/sent state before the
// session can be ended cleanly.
//
// No external AI calls -- free to run. reviewer_id is a trusted parameter
// (real auth is a known, separately-tracked gap, not built here).

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

  let body: { reviewer_id?: string };
  try { body = await req.json(); } catch { return json(400, { error: "invalid_json_body" }); }

  const { reviewer_id } = body;
  if (!reviewer_id) return json(400, { error: "reviewer_id is required" });

  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

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
