import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// Monthly batch generation. Random eligible verse per day from the track's
// approved pool, dual-AI slang translation, then the length + fidelity gates,
// one daily_slots row per (date, theme_track). English-only; Spanish is a
// separate per-slot generate-daily-verse(language="es") pass.
//
// Phase A tuned 2026-08-04 (mirrors generate-daily-verse — keep the helper block
// IN SYNC): 2-3 sentence GSM-7 prompt; per-output sentence bounds + <=2-segment
// DM-wrapped budget + softened/tightened fidelity judge; #1 auto-agree if >=1
// output passes every gate (stored as final_translation); #2 ai_disagreement
// informational only. Optional start_day/end_day for timeout-safe chunks; verses
// already placed in the (month, track) are excluded so chunks/re-runs don't dupe.

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
const SENTENCE_MIN = 2, SENTENCE_MAX = 5, SEGMENT_MAX = 2;
const NAME_ALLOWANCE = "XXXXXXXXXXXXXXX";
// "Written by AI" typographic tells (em/en dash, curly quotes, … ellipsis) that
// lose a teen's trust. Flagged so they never auto-approve. KEEP IN SYNC with
// generate-daily-verse.
const AI_TELLS = /[—–‘’“”…]/;

// House style (locked 2026-08-06, same tier as the em-dash policy): titles/names
// referring to God must be capitalized in all customer-facing content, including
// AI paraphrases. God/Jesus/Christ/Lord are unambiguous proper nouns, so a
// lowercase occurrence is catchable by regex (word-boundary, case-SENSITIVE so
// only the lowercase forms match, never the correct "God"/"Jesus"). Flag ONLY
// (never auto-fix) -> routes to needs_review under reason code
// 'divine_capitalization'. Lowercase PRONOUNS (he/him/his) are handled by the
// fidelity judge instead, since their antecedent needs LLM judgment. "gods" is
// included; a false-gods use (legitimately lowercase) simply gets a human look.
// KEEP IN SYNC with generate-daily-verse.
const DIVINE_NOUN_LOWERCASE = /\b(god|gods|jesus|christ|lord)\b/;

const GSM7_BASIC = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\x1bÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXT = "^{}\\[~]|€";
function gsm7Len(s: string): number | null {
  let n = 0;
  for (const ch of s) { if (GSM7_BASIC.includes(ch)) n += 1; else if (GSM7_EXT.includes(ch)) n += 2; else return null; }
  return n;
}
function smsSegments(s: string): number {
  const g = gsm7Len(s);
  if (g !== null) return g <= 160 ? 1 : Math.ceil(g / 153);
  return s.length <= 70 ? 1 : Math.ceil(s.length / 67);
}
// Emoji-priority policy (LOCKED 2026-08-06): emoji are PERMITTED but are the FIRST
// element cut when a candidate is over the segment budget (graceful degradation,
// NOT a flag). Only when a candidate is over budget AND has emoji do we strip them
// and re-measure (mechanical, no meaning judgment); still-over falls through to the
// normal needs_review path; a candidate that already fits keeps its emoji. Emoji-
// specific so accented Spanish and other legit non-GSM-7 chars survive. KEEP IN
// SYNC with generate-daily-verse.
const EMOJI_RE = /\p{Extended_Pictographic}(?:\u200D\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}\uFE0F\u20E3])*|\p{Regional_Indicator}+/gu;
function hasEmoji(s: string): boolean { return /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(s); }
function stripEmoji(s: string): string {
  return s
    .replace(EMOJI_RE, "")
    .replace(/[\uFE0F\u200D\u20E3]/gu, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ ([.,!?;:])/g, "$1")
    .replace(/ +\n/g, "\n")
    .trim();
}
// Verse citation (LOCKED 2026-08-06): every send carries a parenthetical citation
// appended to the verse paragraph, so it MUST be counted in the segment budget.
// citationFromRef replicates lib/dmAddon.formatCitation (Psalms -> Psalm display
// normalization only). Keep in sync with lib + generate-daily-verse.
function citationFromRef(verseRef: string): string { return `(${verseRef.replace(/^Psalms /, "Psalm ")})`; }
function dmWrapForBudget(v: string, citation: string): string { return `${NAME_ALLOWANCE}, a little note from Me today.\n\n${v} ${citation}\n\nI've got you.`; }
function countSentences(s: string): number { return s.trim().split(/[.!?]+(?:\s|$)/).map((x) => x.trim()).filter(Boolean).length; }

function buildPrompt(verseRef: string, verseText: string): string {
  return `Rewrite this Bible verse (KJV) the way a teenager would actually text a friend -- current, authentic slang, but true to the meaning.

Length: 2 to 3 short sentences. Write like a real teen texting: plain text only, NO emoji. Do NOT use em dashes, en dashes, curly or smart quotes, or a single-character ellipsis -- those read as "written by a bot" and instantly cost a teen's trust. Use plain hyphens (-), straight apostrophes ('), and three separate dots (...) if you need a pause. This also keeps it a short SMS.
Fidelity: say only what the verse says. Do NOT add promises, claims, or ideas that aren't in the source, and don't drop its main point. Restating the same idea in casual words is good; inventing new content is not.
Do not add commentary.

Reference: ${verseRef}
KJV text: "${verseText}"

Respond with ONLY the rewritten verse text, nothing else.`;
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

interface Judgement { faithful: boolean; added_claims: string[]; omitted_core: string[]; drift: boolean; divine_lc_pronouns: string[]; }
async function judgeFidelity(apiKey: string, source: string, rendering: string): Promise<Judgement> {
  const prompt = `You check whether a casual, Gen-Z slang paraphrase of a Bible verse stays TRUE to the source's meaning. The informal, texting-style tone is INTENDED and fine — do NOT penalize slang, casual wording, reordering, changed forms of address (e.g. "O my strength" -> "you're my strength"), collapsing poetic/archaic phrasing into plain words, dropping a liturgical marker like "Selah", or conversational filler ("fr", "no cap", "ngl") — as long as the verse's core meaning is preserved.

Mark it UNFAITHFUL only when it clearly:
- ADDS a substantive claim, promise, or theology NOT in the source, OR
- DROPS or contradicts the source's CORE point, OR
- CHANGES the meaning. In particular:
   • a distinct promise (e.g. "comfort") flattened into a generic one ("support") IS drift; and
   • a specific divine title or covenant name (e.g. "LORD of hosts") reduced to a generic term that loses its meaning (e.g. "the boss", "boss of all", "the man upstairs") IS drift.

Give the paraphrase the benefit of the doubt on style and emphasis; flag ONLY real drift in meaning.

SEPARATELY, check ONE capitalization rule (this does NOT affect the fidelity verdict above): our house style capitalizes pronouns that refer to God -- "He", "Him", "His", "Himself". In the PARAPHRASE, list every lowercase "he", "him", "his", or "himself" whose antecedent in THIS verse is clearly God, Jesus, or the Lord. This needs judgment: if a "he/him/his" refers to a human figure (a king, a disciple, a person in the story), do NOT list it. If none, return [].

Source (KJV): "${source}"
Paraphrase: "${rendering}"

Respond with ONLY compact JSON, no prose, no code fences:
{"faithful": true|false, "added_claims": ["..."], "omitted_core": ["..."], "drift": true|false, "divine_lc_pronouns": ["..."]}`;
  try {
    const raw = await callClaude(apiKey, prompt, 0);
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return { faithful: false, added_claims: ["judge_unparseable"], omitted_core: [], drift: false, divine_lc_pronouns: [] };
    const p = JSON.parse(m[0]);
    return { faithful: p.faithful === true, added_claims: Array.isArray(p.added_claims) ? p.added_claims.map(String) : [], omitted_core: Array.isArray(p.omitted_core) ? p.omitted_core.map(String) : [], drift: p.drift === true, divine_lc_pronouns: Array.isArray(p.divine_lc_pronouns) ? p.divine_lc_pronouns.map(String) : [] };
  } catch (_e) { return { faithful: false, added_claims: ["judge_error"], omitted_core: [], drift: false, divine_lc_pronouns: [] }; }
}

interface OutputEval { text: string; emojiStripped: boolean; flags: string[]; }
function evalOne(label: "A" | "B", text: string, judge: Judgement, citation: string): OutputEval {
  // Emoji-priority pre-processing (before any flagging): over budget + has emoji ->
  // strip emoji and use the stripped text going forward (mechanical, no meaning
  // judgment). Still-over falls through to exceeds_sms_budget below; fits-with-emoji
  // is left untouched.
  let effective = text;
  let emojiStripped = false;
  if (smsSegments(dmWrapForBudget(text, citation)) > SEGMENT_MAX && hasEmoji(text)) {
    effective = stripEmoji(text);
    emojiStripped = true;
  }
  const sentences = countSentences(effective);
  const segments = smsSegments(dmWrapForBudget(effective, citation));
  const flags: string[] = [];
  if (sentences < SENTENCE_MIN) flags.push(`${label}:too_short`);
  if (sentences > SENTENCE_MAX) flags.push(`${label}:too_long`);
  if (segments > SEGMENT_MAX) flags.push(`${label}:exceeds_sms_budget(${segments}seg)`);
  if (AI_TELLS.test(effective)) flags.push(`${label}:ai_tells`);
  // Divine-reference capitalization (house style, locked 2026-08-06). Regex catches
  // lowercase proper nouns; the fidelity judge catches lowercase pronouns referring
  // to God. Either -> flag for human review under 'divine_capitalization', never auto-fix.
  const divineNoun = effective.match(DIVINE_NOUN_LOWERCASE);
  if (divineNoun) flags.push(`${label}:divine_capitalization(noun:${divineNoun[0]})`);
  if (judge.divine_lc_pronouns.length > 0) flags.push(`${label}:divine_capitalization(pronoun:${judge.divine_lc_pronouns.join(",")})`);
  const bad = !judge.faithful || judge.added_claims.length > 0 || judge.omitted_core.length > 0 || judge.drift;
  if (bad) {
    const detail = [...judge.added_claims.map((c) => `added:${c}`), ...judge.omitted_core.map((c) => `omitted:${c}`), judge.drift ? "drift" : ""].filter(Boolean).join("; ");
    flags.push(`${label}:fidelity_risk(${detail || "unfaithful"})`);
  }
  return { text: effective, emojiStripped, flags };
}

async function evaluate(anthropicKey: string, source: string, outA: string, outB: string, citation: string) {
  const [jA, jB] = await Promise.all([judgeFidelity(anthropicKey, source, outA), judgeFidelity(anthropicKey, source, outB)]);
  const a = evalOne("A", outA, jA, citation);
  const b = evalOne("B", outB, jB, citation);
  const sim = similarity(outA, outB);
  // #1 auto-agree if >=1 output passes every gate (prefer A); #2 ai_disagreement informational.
  // Store the EFFECTIVE (possibly emoji-stripped) text as final_translation.
  let status: "agreed" | "needs_review", finalTranslation: string | null = null, chosen: "A" | "B" | null = null, reasons: string[] = [], emojiStripped = false;
  if (a.flags.length === 0) { status = "agreed"; finalTranslation = a.text; chosen = "A"; emojiStripped = a.emojiStripped; }
  else if (b.flags.length === 0) { status = "agreed"; finalTranslation = b.text; chosen = "B"; emojiStripped = b.emojiStripped; }
  else { status = "needs_review"; reasons = [...a.flags, ...b.flags]; }
  return { status, finalTranslation, chosen, reasons, sim, emojiStripped };
}

function daysInMonth(targetMonth: string): string[] {
  const [yearStr, monthStr] = targetMonth.split("-");
  const lastDay = new Date(parseInt(yearStr, 10), parseInt(monthStr, 10), 0).getDate();
  const dates: string[] = [];
  for (let d = 1; d <= lastDay; d++) dates.push(`${yearStr}-${monthStr.padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  return dates;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  let body: { target_month?: string; dry_run?: boolean; theme_track?: string; start_day?: number; end_day?: number };
  try { body = await req.json(); } catch { return json(400, { error: "invalid_json_body" }); }

  const targetMonth = body.target_month;
  const dryRun = body.dry_run === true;
  const themeTrack = body.theme_track || "general";
  const startDay = Number.isInteger(body.start_day) ? (body.start_day as number) : 1;
  const endDay = Number.isInteger(body.end_day) ? (body.end_day as number) : 31;
  if (!targetMonth || !/^\d{4}-\d{2}$/.test(targetMonth)) return json(400, { error: "target_month is required, format YYYY-MM" });

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!dryRun) {
    if (!anthropicKey) return json(500, { error: "server_not_configured", detail: "ANTHROPIC_API_KEY not set" });
    if (!openaiKey) return json(500, { error: "server_not_configured", detail: "OPENAI_API_KEY not set" });
  }

  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return json(401, { error: "unauthorized" });
  const { data: allowed, error: permErr } = await supa.rpc("has_permission", { p_user_id: user.id, p_permission_key: "content.generate" });
  if (permErr) return json(500, { error: "permission_check_failed", detail: permErr.message });
  if (allowed !== true) return json(403, { error: "forbidden", detail: "missing permission 'content.generate'" });

  const dates = daysInMonth(targetMonth).filter((d) => { const day = parseInt(d.slice(-2), 10); return day >= startDay && day <= endDay; });

  const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 1);
  const { data: usedRows, error: usedErr } = await supa.from("used_verses").select("verse_ref").eq("theme_track", themeTrack).gte("used_for_date", cutoff.toISOString().slice(0, 10));
  if (usedErr) return json(500, { error: "failed_to_read_used_verses", detail: usedErr.message });
  const usedRefs = new Set((usedRows || []).map((r: { verse_ref: string }) => r.verse_ref));

  const allDates = daysInMonth(targetMonth);
  const { data: monthRows } = await supa.from("daily_slots").select("verse_ref").eq("theme_track", themeTrack).gte("scheduled_date", allDates[0]).lte("scheduled_date", allDates[allDates.length - 1]);
  for (const r of (monthRows || []) as Array<{ verse_ref: string | null }>) if (r.verse_ref) usedRefs.add(r.verse_ref);

  let candidates: Array<{ book: string; chapter: number; verse: number; text: string }>;
  { const { data, error } = await supa.rpc("get_theme_track_pool", { p_track: themeTrack }); if (error) return json(500, { error: "failed_to_read_theme_pool", detail: error.message }); candidates = data || []; }

  const batchAssigned = new Set<string>();
  const results: Array<Record<string, unknown>> = [];

  for (const targetDate of dates) {
    const eligible = candidates.filter((v) => { const ref = `${v.book} ${v.chapter}:${v.verse}`; return !usedRefs.has(ref) && !batchAssigned.has(ref); });
    if (eligible.length === 0) { results.push({ date: targetDate, error: "no_eligible_verses_in_sample" }); continue; }
    const verseRow = eligible[Math.floor(Math.random() * eligible.length)];
    const verseRef = `${verseRow.book} ${verseRow.chapter}:${verseRow.verse}`;
    batchAssigned.add(verseRef);

    if (dryRun) { results.push({ date: targetDate, verse_ref: verseRef, mode: "dry_run" }); continue; }

    const prompt = buildPrompt(verseRef, verseRow.text);
    try {
      const [outputA, outputB] = await Promise.all([callClaude(anthropicKey!, prompt), callOpenAI(openaiKey!, prompt)]);
      const ev = await evaluate(anthropicKey!, verseRow.text, outputA, outputB, citationFromRef(verseRef));
      const { data: slot, error: slotErr } = await supa.from("daily_slots").upsert({
        scheduled_date: targetDate, theme_track: themeTrack, verse_ref: verseRef,
        status: ev.status, ai_output_a: outputA, ai_output_b: outputB, final_translation: ev.finalTranslation,
        agreement_status: ev.sim >= AGREEMENT_THRESHOLD ? "agreed" : "disagreed",
        needs_review_reasons: ev.reasons, generated_for_batch_month: `${targetMonth}-01`, updated_at: new Date().toISOString(),
      }, { onConflict: "scheduled_date,theme_track" }).select().single();
      if (slotErr) results.push({ date: targetDate, verse_ref: verseRef, error: slotErr.message });
      else results.push({ date: targetDate, verse_ref: verseRef, slot_status: ev.status, chosen_output: ev.chosen, emoji_stripped: ev.emojiStripped, needs_review_reasons: ev.reasons, daily_slot_id: slot.id });
    } catch (e) { results.push({ date: targetDate, verse_ref: verseRef, error: String((e as Error)?.message ?? e) }); }
  }

  const summary = {
    target_month: targetMonth, theme_track: themeTrack, dry_run: dryRun, total_days: dates.length,
    succeeded: results.filter((r) => !r.error).length, failed: results.filter((r) => r.error).length,
    needs_review_count: results.filter((r) => r.slot_status === "needs_review").length,
    agreed_count: results.filter((r) => r.slot_status === "agreed").length,
    unique_verses_assigned: batchAssigned.size,
  };
  return json(200, { summary, results });
});
