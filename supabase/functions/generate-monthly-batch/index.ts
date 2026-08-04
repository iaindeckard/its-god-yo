import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// Monthly batch generation (the month-M+2 process). Random eligible verse per
// day, dual-AI slang translation, then the length + fidelity gates, one
// daily_slots row per (date, theme_track).
//
// ADDED 2026-07-22: theme/mood tracks via `theme_track` (default "general").
// Dedup (used_verses) is per-track. English-only; Spanish is a separate per-slot
// generate-daily-verse(language="es") pass.
//
// ADDED 2026-08-04 (Phase A of docs/VERSE-LENGTH-AND-FIDELITY-SPEC.md): mirrors
// generate-daily-verse — 2-3 sentence GSM-7 prompt, per-output sentence bounds +
// <=2-segment (DM-wrapped, encoding-aware) hard gate, and a fidelity judge
// (output-vs-SOURCE, temp 0) on both outputs. Fail-closed to needs_review. The
// helper block below is kept IN SYNC with generate-daily-verse (same convention
// as the existing duplicated similarity()/callClaude()).

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
const GSM7_EXT = "^{}\\[~]|€";
function gsm7Len(s: string): number | null {
  let n = 0;
  for (const ch of s) {
    if (GSM7_BASIC.includes(ch)) n += 1;
    else if (GSM7_EXT.includes(ch)) n += 2;
    else return null;
  }
  return n;
}
function smsSegments(s: string): number {
  const g = gsm7Len(s);
  if (g !== null) return g <= 160 ? 1 : Math.ceil(g / 153);
  const units = s.length;
  return units <= 70 ? 1 : Math.ceil(units / 67);
}
// Replicates lib/dmAddon.composeDailyMessage({dm:true}) EN — KEEP IN SYNC.
function dmWrapForBudget(verseText: string): string {
  return `${NAME_ALLOWANCE}, a little note from Me today.\n\n${verseText}\n\nI've got you.`;
}
function countSentences(s: string): number {
  return s.trim().split(/[.!?]+(?:\s|$)/).map((x) => x.trim()).filter(Boolean).length;
}

function buildPrompt(verseRef: string, verseText: string): string {
  return `Rewrite this Bible verse (KJV) the way a teenager would actually text a friend -- current, authentic slang, but true to the meaning.

Length: 2 to 3 short sentences. Plain text only -- NO emoji and no fancy punctuation (use straight quotes ' and a hyphen -, not curly quotes or em dashes), so it stays a short SMS.
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

interface Judgement { faithful: boolean; added_claims: string[]; omitted_core: string[]; drift: boolean; }
async function judgeFidelity(apiKey: string, source: string, rendering: string): Promise<Judgement> {
  const prompt = `You are a strict Scripture-fidelity checker. Compare a casual paraphrase to its source verse.

Source (KJV): "${source}"
Paraphrase: "${rendering}"

A faithful paraphrase may restate or lightly expand the SAME idea in casual/slang language, but must NOT introduce claims, promises, or theology not present in the source, and must NOT drop the verse's core point.

Respond with ONLY compact JSON, no prose, no code fences:
{"faithful": true|false, "added_claims": ["..."], "omitted_core": ["..."], "drift": true|false}
When genuinely unsure, set faithful=false.`;
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

function evalFlags(label: "A" | "B", text: string, judge: Judgement): string[] {
  const sentences = countSentences(text);
  const segments = smsSegments(dmWrapForBudget(text));
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
  return flags;
}

async function evaluate(anthropicKey: string, source: string, outA: string, outB: string) {
  const [jA, jB] = await Promise.all([judgeFidelity(anthropicKey, source, outA), judgeFidelity(anthropicKey, source, outB)]);
  const reasons: string[] = [...evalFlags("A", outA, jA), ...evalFlags("B", outB, jB)];
  const sim = similarity(outA, outB);
  if (sim < AGREEMENT_THRESHOLD) reasons.push("ai_disagreement");
  const status = reasons.length > 0 ? "needs_review" : "agreed";
  return { reasons, status, sim };
}

function daysInMonth(targetMonth: string): string[] {
  const [yearStr, monthStr] = targetMonth.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const lastDay = new Date(year, month, 0).getDate();
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
  // Optional day window so a big month can be run in timeout-safe chunks
  // (the added fidelity judge ~doubles the AI calls). Chunks + re-runs stay
  // dedup-safe: verses already placed in this (month, track) are excluded below.
  const startDay = Number.isInteger(body.start_day) ? (body.start_day as number) : 1;
  const endDay = Number.isInteger(body.end_day) ? (body.end_day as number) : 31;
  if (!targetMonth || !/^\d{4}-\d{2}$/.test(targetMonth)) {
    return json(400, { error: "target_month is required, format YYYY-MM" });
  }

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!dryRun) {
    if (!anthropicKey) return json(500, { error: "server_not_configured", detail: "ANTHROPIC_API_KEY not set" });
    if (!openaiKey) return json(500, { error: "server_not_configured", detail: "OPENAI_API_KEY not set" });
  }

  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

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

  const dates = daysInMonth(targetMonth).filter((d) => {
    const day = parseInt(d.slice(-2), 10);
    return day >= startDay && day <= endDay;
  });

  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  const { data: usedRows, error: usedErr } = await supa
    .from("used_verses").select("verse_ref").eq("theme_track", themeTrack).gte("used_for_date", cutoff.toISOString().slice(0, 10));
  if (usedErr) return json(500, { error: "failed_to_read_used_verses", detail: usedErr.message });
  const usedRefs = new Set((usedRows || []).map((r: { verse_ref: string }) => r.verse_ref));

  // Also exclude verses already placed on OTHER days of this (month, track) — so
  // chunked runs and re-runs never assign the same verse twice within a month.
  const allDates = daysInMonth(targetMonth);
  const { data: monthRows } = await supa
    .from("daily_slots").select("verse_ref").eq("theme_track", themeTrack)
    .gte("scheduled_date", allDates[0]).lte("scheduled_date", allDates[allDates.length - 1]);
  for (const r of (monthRows || []) as Array<{ verse_ref: string | null }>) {
    if (r.verse_ref) usedRefs.add(r.verse_ref);
  }

  let candidates: Array<{ book: string; chapter: number; verse: number; text: string }>;
  {
    const { data, error } = await supa.rpc("get_theme_track_pool", { p_track: themeTrack });
    if (error) return json(500, { error: "failed_to_read_theme_pool", detail: error.message });
    candidates = data || [];
  }

  const batchAssigned = new Set<string>();
  const results: Array<Record<string, unknown>> = [];

  for (const targetDate of dates) {
    const eligible = candidates.filter((v) => {
      const ref = `${v.book} ${v.chapter}:${v.verse}`;
      return !usedRefs.has(ref) && !batchAssigned.has(ref);
    });
    if (eligible.length === 0) {
      results.push({ date: targetDate, error: "no_eligible_verses_in_sample" });
      continue;
    }
    const verseRow = eligible[Math.floor(Math.random() * eligible.length)];
    const verseRef = `${verseRow.book} ${verseRow.chapter}:${verseRow.verse}`;
    batchAssigned.add(verseRef);

    if (dryRun) {
      results.push({ date: targetDate, verse_ref: verseRef, mode: "dry_run", note: "no AI calls made, no daily_slots row written" });
      continue;
    }

    const prompt = buildPrompt(verseRef, verseRow.text);
    try {
      const [outputA, outputB] = await Promise.all([callClaude(anthropicKey!, prompt), callOpenAI(openaiKey!, prompt)]);
      const { reasons, status, sim } = await evaluate(anthropicKey!, verseRow.text, outputA, outputB);

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
          generated_for_batch_month: `${targetMonth}-01`,
          updated_at: new Date().toISOString(),
        }, { onConflict: "scheduled_date,theme_track" })
        .select().single();

      if (slotErr) results.push({ date: targetDate, verse_ref: verseRef, error: slotErr.message });
      else results.push({ date: targetDate, verse_ref: verseRef, slot_status: status, needs_review_reasons: reasons, daily_slot_id: slot.id });
    } catch (e) {
      results.push({ date: targetDate, verse_ref: verseRef, error: String((e as Error)?.message ?? e) });
    }
  }

  const summary = {
    target_month: targetMonth,
    theme_track: themeTrack,
    dry_run: dryRun,
    total_days: dates.length,
    succeeded: results.filter((r) => !r.error).length,
    failed: results.filter((r) => r.error).length,
    needs_review_count: results.filter((r) => r.slot_status === "needs_review").length,
    agreed_count: results.filter((r) => r.slot_status === "agreed").length,
    unique_verses_assigned: batchAssigned.size,
  };

  return json(200, { summary, results });
});
