import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// Reject a verse entirely -- the KJV pick was bad, not the translation.
// Per the locked spec: picks a genuinely new verse (respecting 12-month
// dedup AND excluding every other verse already assigned elsewhere in the
// same batch month, AND excluding the just-rejected verse itself), re-runs
// BOTH AI generations fresh, and returns the regenerated slot to the
// reviewer in the same response -- it does NOT auto-approve the new content,
// the reviewer still has to look at it and take a real approve action.
//
// COSTS REAL MONEY -- two fresh AI calls, same ~$0.005 estimate as a single
// generation. Logs the rejection to corrections_log either way.
//
// Optionally accepts review_session_id: when a reviewer is rejecting inside a
// tracked review session, we stamp the corrections_log row with it so
// review-session-end can tell which reject_verse actions belong to the
// session and enforce the "resolve what you rejected before ending" rule.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

function similarity(a: string, b: string): number {
  const norm = (s: string) => new Set(s.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/).filter(Boolean));
  const setA = norm(a), setB = norm(b);
  const intersection = [...setA].filter((w) => setB.has(w)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}
const AGREEMENT_THRESHOLD = 0.35;

function buildPrompt(verseRef: string, verseText: string): string {
  return `Translate this Bible verse (KJV) into language a teenager would actually text a friend -- current, authentic slang, but respectful of the meaning. Keep it short, like a real text message. Do not add commentary, just the translated verse.

Reference: ${verseRef}
KJV text: "${verseText}"

Respond with ONLY the translated verse text, nothing else.`;
}

async function callClaude(apiKey: string, prompt: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 200, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.content || []).map((b: { text?: string }) => b.text || "").join("").trim();
}

async function callOpenAI(apiKey: string, prompt: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", "authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "gpt-4o", max_tokens: 200, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) throw new Error(`OpenAI API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new Error("OpenAI response missing choices[0].message.content");
  return text.trim();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  let body: { daily_slot_id?: string; reviewer_id?: string; reason?: string; review_session_id?: string };
  try { body = await req.json(); } catch { return json(400, { error: "invalid_json_body" }); }

  const { daily_slot_id, reviewer_id, reason, review_session_id } = body;
  if (!daily_slot_id || !reviewer_id || !reason) {
    return json(400, { error: "daily_slot_id, reviewer_id, and reason are all required" });
  }

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!anthropicKey || !openaiKey) return json(500, { error: "server_not_configured" });

  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  const { data: slot, error: fetchErr } = await supa.from("daily_slots").select("*").eq("id", daily_slot_id).single();
  if (fetchErr || !slot) return json(404, { error: "daily_slot_not_found" });
  if (slot.status === "approved" || slot.status === "sent") {
    return json(409, { error: "already_resolved", detail: `slot status is already '${slot.status}'` });
  }

  // Log the rejection first, regardless of what happens next. Stamp the
  // session id when supplied so end-of-session unresolved detection works.
  const { error: logErr } = await supa.from("corrections_log").insert({
    daily_slot_id,
    action_type: "reject_verse",
    original_verse_ref: slot.verse_ref,
    reason,
    corrected_by: reviewer_id,
    review_session_id: review_session_id ?? null,
  });
  if (logErr) return json(500, { error: "failed_to_log_correction", detail: logErr.message });

  // 12-month dedup + within-batch dedup (other slots sharing this batch month).
  const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 1);
  const { data: usedRows } = await supa.from("used_verses").select("verse_ref").gte("used_for_date", cutoff.toISOString().slice(0, 10));
  const usedRefs = new Set((usedRows || []).map((r: { verse_ref: string }) => r.verse_ref));
  usedRefs.add(slot.verse_ref); // exclude the just-rejected verse itself

  if (slot.generated_for_batch_month) {
    const { data: batchRows } = await supa.from("daily_slots").select("verse_ref").eq("generated_for_batch_month", slot.generated_for_batch_month).neq("id", daily_slot_id);
    (batchRows || []).forEach((r: { verse_ref: string }) => usedRefs.add(r.verse_ref));
  }

  const { data: candidates, error: candErr } = await supa.rpc("get_random_kjv_verses", { sample_size: 1000 });
  if (candErr) return json(500, { error: "failed_to_read_kjv_verses", detail: candErr.message });
  const eligible = (candidates || []).filter((v: { book: string; chapter: number; verse: number }) => !usedRefs.has(`${v.book} ${v.chapter}:${v.verse}`));
  if (eligible.length === 0) return json(500, { error: "no_eligible_replacement_verse" });
  const newVerse = eligible[Math.floor(Math.random() * eligible.length)];
  const newVerseRef = `${newVerse.book} ${newVerse.chapter}:${newVerse.verse}`;

  const prompt = buildPrompt(newVerseRef, newVerse.text);
  let outputA: string, outputB: string;
  try {
    [outputA, outputB] = await Promise.all([callClaude(anthropicKey, prompt), callOpenAI(openaiKey, prompt)]);
  } catch (e) {
    return json(502, { error: "regeneration_failed", detail: String((e as Error)?.message ?? e), new_verse_ref: newVerseRef });
  }

  const simScore = similarity(outputA, outputB);
  const agreementStatus = simScore >= AGREEMENT_THRESHOLD ? "agreed" : "disagreed";
  const newStatus = agreementStatus === "agreed" ? "agreed" : "needs_review";

  const { data: updated, error: updateErr } = await supa
    .from("daily_slots")
    .update({
      verse_ref: newVerseRef,
      status: newStatus,
      ai_output_a: outputA,
      ai_output_b: outputB,
      agreement_status: agreementStatus,
      final_translation: null,
      approved_by: null,
      approved_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", daily_slot_id)
    .select().single();
  if (updateErr) return json(500, { error: "failed_to_update_slot", detail: updateErr.message });

  return json(200, {
    status: "verse_rejected_and_regenerated",
    old_verse_ref: slot.verse_ref,
    slot: updated,
  });
});
