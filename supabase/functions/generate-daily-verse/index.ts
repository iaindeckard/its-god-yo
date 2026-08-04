import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// Daily verse generation (single slot). CHANGED 2026-07-30: candidate verse
// pool comes from the curated, human-approved verse_theme_tags for the track
// (get_theme_track_pool) -- no longer a random full-KJV sample.
//
// ADDED 2026-07-20: bilingual support via `language` param (en default / es).
//   es does NOT pick a verse — it reuses the reference already chosen for the
//   SAME (date, theme_track) slot and translates the RV1909 source.
//
// ADDED 2026-07-22: theme/mood tracks via `theme_track` param (default "general").
//
// ADDED 2026-08-04 (Phase A of docs/VERSE-LENGTH-AND-FIDELITY-SPEC.md):
//   - Prompt now targets 2-3 short sentences, GSM-7 plain text (no emoji).
//   - Deterministic guards on EACH output: sentence bounds (2..5), and the HARD
//     gate = <=2 SMS segments measured on the DM-from-Him-WRAPPED worst case
//     (encoding-aware GSM-7 vs UCS-2). See dmWrapForBudget().
//   - Fidelity judge (output-vs-SOURCE, temp 0) on BOTH outputs; any added claim,
//     omitted core meaning, or tone/theology drift hard-blocks auto-approval.
//   Fail-closed: a slot auto-marks 'agreed' ONLY when both outputs pass every
//   check AND the two agree; otherwise 'needs_review' with specific reasons.

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
const SENTENCE_MIN = 2;
const SENTENCE_MAX = 5;
const SEGMENT_MAX = 2;
const NAME_ALLOWANCE = "XXXXXXXXXXXXXXX"; // 15-char stand-in; real firstName unknown at generation

// ---- GSM-7 vs UCS-2 SMS segment math (mirrors Twilio's encoding rules) ----
const GSM7_BASIC = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\x1bÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXT = "^{}\\[~]|€"; // each costs 2 GSM-7 chars
function gsm7Len(s: string): number | null {
  let n = 0;
  for (const ch of s) {
    if (GSM7_BASIC.includes(ch)) n += 1;
    else if (GSM7_EXT.includes(ch)) n += 2;
    else return null; // a non-GSM char forces UCS-2 for the whole message
  }
  return n;
}
function smsSegments(s: string): number {
  const g = gsm7Len(s);
  if (g !== null) return g <= 160 ? 1 : Math.ceil(g / 153);
  const units = s.length; // UTF-16 code units (Twilio counts these for UCS-2; surrogates = 2)
  return units <= 70 ? 1 : Math.ceil(units / 67);
}
// Replicates lib/dmAddon.composeDailyMessage({dm:true}) — KEEP IN SYNC. Worst case
// for the segment budget: the same verse sent DM-wrapped, with a 15-char name.
function dmWrapForBudget(verseText: string, lang: "en" | "es"): string {
  return lang === "es"
    ? `${NAME_ALLOWANCE}, algo de Mi parte hoy.\n\n${verseText}\n\nEstoy contigo.`
    : `${NAME_ALLOWANCE}, a little note from Me today.\n\n${verseText}\n\nI've got you.`;
}

function countSentences(s: string): number {
  return s.trim().split(/[.!?]+(?:\s|$)/).map((x) => x.trim()).filter(Boolean).length;
}

// verse_ref format is "<book> <chapter>:<verse>"; book may contain spaces/digits.
function parseVerseRef(ref: string): { book: string; chapter: number; verse: number } | null {
  const m = ref.match(/^(.+)\s+(\d+):(\d+)$/);
  if (!m) return null;
  return { book: m[1], chapter: parseInt(m[2], 10), verse: parseInt(m[3], 10) };
}

function buildPromptEn(verseRef: string, verseText: string): string {
  return `Rewrite this Bible verse (KJV) the way a teenager would actually text a friend -- current, authentic slang, but true to the meaning.

Length: 2 to 3 short sentences. Plain text only -- NO emoji and no fancy punctuation (use straight quotes ' and a hyphen -, not curly quotes or em dashes), so it stays a short SMS.
Fidelity: say only what the verse says. Do NOT add promises, claims, or ideas that aren't in the source, and don't drop its main point. Restating the same idea in casual words is good; inventing new content is not.
Do not add commentary.

Reference: ${verseRef}
KJV text: "${verseText}"

Respond with ONLY the rewritten verse text, nothing else.`;
}

function buildPromptEs(verseRef: string, verseText: string): string {
  return `Reescribe este versículo bíblico (Reina-Valera 1909) como un adolescente mexicano realmente se lo enviaría a un amigo por mensaje -- jerga actual y auténtica, pero fiel al significado.

Largo: 2 a 3 oraciones cortas. Solo texto -- SIN emojis, para que quepa en un SMS corto.
Fidelidad: di solo lo que dice el versículo. NO agregues promesas, afirmaciones ni ideas que no estén en la fuente, y no omitas su punto principal. Reformular la misma idea en palabras casuales está bien; inventar contenido nuevo no.
No agregues comentarios.

Referencia: ${verseRef}
Texto RV1909: "${verseText}"

Responde SOLO con el versículo reescrito, nada más.`;
}

async function callClaude(apiKey: string, prompt: string, temperature = 1): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 300, temperature, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.content || []).map((b: { text?: string }) => b.text || "").join("").trim();
}

async function callOpenAI(apiKey: string, prompt: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", "authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "gpt-4o", max_tokens: 300, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) throw new Error(`OpenAI API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new Error("OpenAI response missing choices[0].message.content");
  return text.trim();
}

interface Judgement { faithful: boolean; added_claims: string[]; omitted_core: string[]; drift: boolean; }

// Fidelity judge: compares a rendering to its SOURCE verse. Fail-closed — on any
// error or unparseable output we return "unfaithful" so the slot flags for review.
async function judgeFidelity(apiKey: string, source: string, rendering: string, lang: "en" | "es"): Promise<Judgement> {
  const prompt = `You are a strict Scripture-fidelity checker. Compare a casual paraphrase to its source verse.

Source (${lang === "es" ? "Reina-Valera 1909" : "KJV"}): "${source}"
Paraphrase: "${rendering}"

A faithful paraphrase may restate or lightly expand the SAME idea in casual/slang language, but must NOT introduce claims, promises, or theology not present in the source, and must NOT drop the verse's core point.

Respond with ONLY compact JSON, no prose, no code fences:
{"faithful": true|false, "added_claims": ["..."], "omitted_core": ["..."], "drift": true|false}
"added_claims" = anything asserted that isn't in the source. "omitted_core" = core meaning dropped. "drift" = tone/theology changed. When genuinely unsure, set faithful=false.`;
  try {
    const raw = await callClaude(apiKey, prompt, 0);
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return { faithful: false, added_claims: ["judge_unparseable"], omitted_core: [], drift: false };
    const p = JSON.parse(m[0]);
    return {
      faithful: p.faithful === true,
      added_claims: Array.isArray(p.added_claims) ? p.added_claims.map(String) : [],
      omitted_core: Array.isArray(p.omitted_core) ? p.omitted_core.map(String) : [],
      drift: p.drift === true,
    };
  } catch (_e) {
    return { faithful: false, added_claims: ["judge_error"], omitted_core: [], drift: false };
  }
}

interface OutputEval { label: "A" | "B"; sentences: number; segments: number; judge: Judgement; flags: string[]; }

function evalOne(label: "A" | "B", text: string, source: string, lang: "en" | "es", judge: Judgement): OutputEval {
  const sentences = countSentences(text);
  const segments = smsSegments(dmWrapForBudget(text, lang));
  const flags: string[] = [];
  if (sentences < SENTENCE_MIN) flags.push(`${label}:too_short`);
  if (sentences > SENTENCE_MAX) flags.push(`${label}:too_long`);
  if (segments > SEGMENT_MAX) flags.push(`${label}:exceeds_sms_budget(${segments}seg)`);
  const fidelityBad = !judge.faithful || judge.added_claims.length > 0 || judge.omitted_core.length > 0 || judge.drift;
  if (fidelityBad) {
    const detail = [
      ...judge.added_claims.map((c) => `added:${c}`),
      ...judge.omitted_core.map((c) => `omitted:${c}`),
      judge.drift ? "drift" : "",
    ].filter(Boolean).join("; ");
    flags.push(`${label}:fidelity_risk(${detail || "unfaithful"})`);
  }
  return { label, sentences, segments, judge, flags };
}

// Runs the length + fidelity gates on both outputs. Returns the aggregated
// needs_review reasons and the fail-closed slot status.
async function evaluate(anthropicKey: string, source: string, outA: string, outB: string, lang: "en" | "es") {
  const [jA, jB] = await Promise.all([
    judgeFidelity(anthropicKey, source, outA, lang),
    judgeFidelity(anthropicKey, source, outB, lang),
  ]);
  const evalA = evalOne("A", outA, source, lang, jA);
  const evalB = evalOne("B", outB, source, lang, jB);
  const sim = similarity(outA, outB);
  const reasons: string[] = [...evalA.flags, ...evalB.flags];
  if (sim < AGREEMENT_THRESHOLD) reasons.push("ai_disagreement");
  const status = reasons.length > 0 ? "needs_review" : "agreed";
  return { reasons, status, sim, evalA, evalB };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  let body: { target_date?: string; verse_book?: string; verse_chapter?: number; verse_verse?: number; language?: string; theme_track?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_json_body" });
  }

  const targetDate = body.target_date;
  if (!targetDate) return json(400, { error: "target_date is required (YYYY-MM-DD). Single-slot generation only in this version -- full-month batch is a separate function." });

  const language = body.language === "es" ? "es" : "en";
  const themeTrack = body.theme_track || "general";

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!anthropicKey) return json(500, { error: "server_not_configured", detail: "ANTHROPIC_API_KEY not set" });
  if (!openaiKey) return json(500, { error: "server_not_configured", detail: "OPENAI_API_KEY not set" });

  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // AUTH: require an authenticated staff member with content.generate.
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
    p_permission_key: "content.generate",
  });
  if (permErr) return json(500, { error: "permission_check_failed", detail: permErr.message });
  if (allowed !== true) return json(403, { error: "forbidden", detail: "missing permission 'content.generate'" });

  // ==================== SPANISH PATH ====================
  if (language === "es") {
    const { data: slotRow, error: slotReadErr } = await supa
      .from("daily_slots")
      .select("id, verse_ref")
      .eq("scheduled_date", targetDate)
      .eq("theme_track", themeTrack)
      .maybeSingle();
    if (slotReadErr) return json(500, { error: "failed_to_read_daily_slot", detail: slotReadErr.message });
    if (!slotRow || !slotRow.verse_ref) {
      return json(409, { error: "no_english_slot_for_date", detail: `No daily_slots row with a verse_ref exists for ${targetDate} / track ${themeTrack}. Generate the English verse first -- Spanish reuses that same reference.` });
    }

    const verseRef = slotRow.verse_ref as string;
    const parsed = parseVerseRef(verseRef);
    if (!parsed) return json(500, { error: "unparseable_verse_ref", detail: verseRef });

    const { data: esVerse, error: esErr } = await supa
      .from("rv1909_verses")
      .select("book, chapter, verse, text")
      .eq("book", parsed.book).eq("chapter", parsed.chapter).eq("verse", parsed.verse)
      .maybeSingle();
    if (esErr) return json(500, { error: "failed_to_read_rv1909_verses", detail: esErr.message });
    if (!esVerse) return json(404, { error: "verse_not_found_in_rv1909", detail: `${verseRef} has no matching row in rv1909_verses.` });

    const prompt = buildPromptEs(verseRef, esVerse.text);

    let outputA: string, outputB: string;
    try {
      [outputA, outputB] = await Promise.all([callClaude(anthropicKey, prompt), callOpenAI(openaiKey, prompt)]);
    } catch (e) {
      return json(502, { error: "generation_failed", detail: String((e as Error)?.message ?? e) });
    }

    const { reasons, status: statusEs, sim, evalA, evalB } = await evaluate(anthropicKey, esVerse.text, outputA, outputB, "es");

    const { data: updated, error: updErr } = await supa
      .from("daily_slots")
      .update({
        ai_output_a_es: outputA,
        ai_output_b_es: outputB,
        agreement_status_es: sim >= AGREEMENT_THRESHOLD ? "agreed" : "disagreed",
        status_es: statusEs,
        needs_review_reasons_es: reasons,
        updated_at: new Date().toISOString(),
      })
      .eq("scheduled_date", targetDate)
      .eq("theme_track", themeTrack)
      .select()
      .single();
    if (updErr) return json(500, { error: "failed_to_write_daily_slot_es", detail: updErr.message });

    return json(200, {
      status: "generated", language: "es", theme_track: themeTrack, verse_ref: verseRef,
      source_table: "rv1909_verses", source_text_es: esVerse.text,
      ai_output_a_es: outputA, ai_output_b_es: outputB, similarity_score: sim,
      slot_status_es: statusEs, needs_review_reasons_es: reasons,
      checks: { a: { sentences: evalA.sentences, segments: evalA.segments, judge: evalA.judge }, b: { sentences: evalB.sentences, segments: evalB.segments, judge: evalB.judge } },
      daily_slot_id: updated.id,
    });
  }

  // ==================== ENGLISH PATH ====================
  let verseRow: { book: string; chapter: number; verse: number; text: string } | null = null;

  if (body.verse_book && body.verse_chapter && body.verse_verse) {
    const { data, error } = await supa
      .from("kjv_verses").select("book, chapter, verse, text")
      .eq("book", body.verse_book).eq("chapter", body.verse_chapter).eq("verse", body.verse_verse).single();
    if (error || !data) return json(404, { error: "verse_not_found" });
    verseRow = data;
  } else {
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 1);
    const { data: usedRows, error: usedErr } = await supa
      .from("used_verses").select("verse_ref").eq("theme_track", themeTrack).gte("used_for_date", cutoff.toISOString().slice(0, 10));
    if (usedErr) return json(500, { error: "failed_to_read_used_verses", detail: usedErr.message });
    const usedRefs = new Set((usedRows || []).map((r: { verse_ref: string }) => r.verse_ref));

    const { data: pool, error: poolErr } = await supa.rpc("get_theme_track_pool", { p_track: themeTrack });
    if (poolErr) return json(500, { error: "failed_to_read_theme_pool", detail: poolErr.message });
    const eligible = (pool || []).filter((v: { book: string; chapter: number; verse: number }) => !usedRefs.has(`${v.book} ${v.chapter}:${v.verse}`));
    if (eligible.length === 0) return json(409, { error: "no_approved_verses_for_track", detail: `Track '${themeTrack}' has no approved, un-used verses. Add approved verse_theme_tags for this track first.` });
    verseRow = eligible[Math.floor(Math.random() * eligible.length)];
  }

  const verseRef = `${verseRow!.book} ${verseRow!.chapter}:${verseRow!.verse}`;
  const prompt = buildPromptEn(verseRef, verseRow!.text);

  let outputA: string, outputB: string;
  try {
    [outputA, outputB] = await Promise.all([callClaude(anthropicKey, prompt), callOpenAI(openaiKey, prompt)]);
  } catch (e) {
    return json(502, { error: "generation_failed", detail: String((e as Error)?.message ?? e) });
  }

  const { reasons, status, sim, evalA, evalB } = await evaluate(anthropicKey, verseRow!.text, outputA, outputB, "en");

  const { data: slot, error: slotErr } = await supa
    .from("daily_slots")
    .upsert({
      scheduled_date: targetDate,
      theme_track: themeTrack,
      verse_ref: verseRef,
      status,
      ai_output_a: outputA,
      ai_output_b: outputB,
      agreement_status: sim >= AGREEMENT_THRESHOLD ? "agreed" : "disagreed",
      needs_review_reasons: reasons,
      updated_at: new Date().toISOString(),
    }, { onConflict: "scheduled_date,theme_track" })
    .select()
    .single();
  if (slotErr) return json(500, { error: "failed_to_write_daily_slot", detail: slotErr.message });

  return json(200, {
    status: "generated", language: "en", theme_track: themeTrack, verse_ref: verseRef,
    ai_output_a: outputA, ai_output_b: outputB, similarity_score: sim,
    slot_status: status, needs_review_reasons: reasons,
    checks: { a: { sentences: evalA.sentences, segments: evalA.segments, judge: evalA.judge }, b: { sentences: evalB.sentences, segments: evalB.segments, judge: evalB.judge } },
    daily_slot_id: slot.id,
  });
});
