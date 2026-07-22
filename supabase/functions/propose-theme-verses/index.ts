import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// Theme/mood tagging — AI-assisted FIRST PASS (spec: IGY-Theme-Mood-*).
//
// Given a theme_track, sample eligible KJV verses that aren't already tagged for
// that track, ask an AI which ones genuinely fit the theme (with a short reason
// and a confidence), and write them to verse_theme_tags as 'proposed'. A human
// then approves/rejects (the review step) before a track's generation can use
// them — this pass NEVER auto-approves. Mirrors how generate-* call the same
// AI muscle, just for selection instead of translation.
//
// Body: { theme_track: string, sample_size?: number (default 60), dry_run?: bool }

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

async function callClaude(apiKey: string, prompt: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1500, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.content || []).map((b: { text?: string }) => b.text || "").join("").trim();
}

/** Pull the first JSON array out of a model response (tolerates code fences/prose). */
function parseJsonArray(raw: string): unknown[] {
  const fenced = raw.replace(/```(?:json)?/gi, "").trim();
  const start = fenced.indexOf("[");
  const end = fenced.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) throw new Error("no JSON array in model output");
  return JSON.parse(fenced.slice(start, end + 1));
}

function buildPrompt(label: string, description: string, candidates: Array<{ ref: string; text: string }>): string {
  const list = candidates.map((c, i) => `${i + 1}. ${c.ref} — "${c.text}"`).join("\n");
  return `You are helping curate a daily-scripture product. We are building a themed track called "${label}" (${description}).

From the candidate KJV verses below, select ONLY the ones that genuinely fit this theme — a verse a person who chose "${label}" would find on-theme and meaningful. Be selective: skip verses that are off-topic, fragmentary, or only loosely related. It is fine to return few or none.

For each verse you select, give a confidence from 0 to 1 and a short reason (under 12 words).

Candidates:
${list}

Respond with ONLY a JSON array, no prose, no code fences. Each element:
{"ref": "<exact reference from the list>", "confidence": <0..1>, "reason": "<short>"}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  let body: { theme_track?: string; sample_size?: number; dry_run?: boolean };
  try { body = await req.json(); } catch { return json(400, { error: "invalid_json_body" }); }

  const themeTrack = body.theme_track;
  const sampleSize = Math.min(Math.max(body.sample_size ?? 60, 1), 150);
  const dryRun = body.dry_run === true;
  if (!themeTrack) return json(400, { error: "theme_track is required" });
  if (themeTrack === "general") return json(400, { error: "the 'general' track uses the full eligible pool and is not tagged" });

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!dryRun && !anthropicKey) return json(500, { error: "server_not_configured", detail: "ANTHROPIC_API_KEY not set" });

  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  // Resolve the track (and get its label/description for the prompt).
  const { data: track, error: trackErr } = await supa
    .from("theme_tracks").select("key, label, description, active").eq("key", themeTrack).maybeSingle();
  if (trackErr) return json(500, { error: "failed_to_read_theme_track", detail: trackErr.message });
  if (!track) return json(404, { error: "unknown_theme_track", detail: themeTrack });

  // Already-tagged refs for this track (any status) — don't re-propose them.
  const { data: taggedRows, error: tagErr } = await supa
    .from("verse_theme_tags").select("verse_ref").eq("theme_track", themeTrack);
  if (tagErr) return json(500, { error: "failed_to_read_existing_tags", detail: tagErr.message });
  const alreadyTagged = new Set((taggedRows || []).map((r: { verse_ref: string }) => r.verse_ref));

  // Random sample of eligible verses (same pool + exclusion the engine uses).
  const { data: candidates, error: candErr } = await supa.rpc("get_random_kjv_verses", { sample_size: sampleSize });
  if (candErr) return json(500, { error: "failed_to_read_kjv_verses", detail: candErr.message });
  const pool = (candidates || [])
    .map((v: { book: string; chapter: number; verse: number; text: string }) => ({ ref: `${v.book} ${v.chapter}:${v.verse}`, text: v.text }))
    .filter((c: { ref: string }) => !alreadyTagged.has(c.ref));

  if (pool.length === 0) return json(200, { theme_track: themeTrack, sampled: 0, proposed: 0, note: "no un-tagged candidates in sample" });
  if (dryRun) return json(200, { theme_track: themeTrack, sampled: pool.length, dry_run: true, note: "no AI call, no writes", candidates: pool.map((c) => c.ref) });

  let modelOut: string;
  try {
    modelOut = await callClaude(anthropicKey!, buildPrompt(track.label, track.description ?? track.label, pool));
  } catch (e) {
    return json(502, { error: "proposal_failed", detail: String((e as Error)?.message ?? e) });
  }

  let picks: Array<{ ref?: string; confidence?: number; reason?: string }>;
  try {
    picks = parseJsonArray(modelOut) as typeof picks;
  } catch (e) {
    return json(502, { error: "unparseable_model_output", detail: String((e as Error)?.message ?? e), raw: modelOut.slice(0, 500) });
  }

  // Only accept picks whose ref was actually in the sampled pool.
  const poolRefs = new Set(pool.map((c) => c.ref));
  const rows = picks
    .filter((p) => typeof p.ref === "string" && poolRefs.has(p.ref!) && !alreadyTagged.has(p.ref!))
    .map((p) => ({
      verse_ref: p.ref!,
      theme_track: themeTrack,
      status: "proposed",
      proposed_by: "ai:claude-sonnet-4-6",
      confidence: typeof p.confidence === "number" ? p.confidence : null,
      rationale: typeof p.reason === "string" ? p.reason.slice(0, 300) : null,
      updated_at: new Date().toISOString(),
    }));

  if (rows.length === 0) return json(200, { theme_track: themeTrack, sampled: pool.length, proposed: 0, note: "AI selected none from this sample" });

  const { data: inserted, error: insErr } = await supa
    .from("verse_theme_tags")
    .upsert(rows, { onConflict: "verse_ref,theme_track", ignoreDuplicates: true })
    .select("verse_ref, confidence, rationale");
  if (insErr) return json(500, { error: "failed_to_write_tags", detail: insErr.message });

  return json(200, {
    theme_track: themeTrack,
    label: track.label,
    sampled: pool.length,
    proposed: inserted?.length ?? rows.length,
    proposals: inserted ?? rows.map((r) => ({ verse_ref: r.verse_ref, confidence: r.confidence, rationale: r.rationale })),
  });
});
