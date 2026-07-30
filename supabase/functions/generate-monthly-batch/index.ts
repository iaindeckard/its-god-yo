import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// Monthly batch generation (the month-M+2 process). Random eligible verse per
// day, dual-AI slang translation, agreement/needs_review, one daily_slots row
// per (date, theme_track).
//
// ADDED 2026-07-22: theme/mood tracks via `theme_track` (default "general").
// Run this ONCE PER TRACK per month — 7 tracks = 7 batches (7x review workload),
// which is the whole shape of Option A.
//   - "general": random from the full eligible KJV pool (unchanged).
//   - a themed track: candidate pool = that track's APPROVED verse_theme_tags
//     only (via get_theme_track_pool). If a track has fewer approved verses than
//     days in the month, some days report no_eligible_verses_in_sample — approve
//     more tags and re-run.
// Dedup (used_verses) is per-track. This function is English-only; Spanish is a
// separate per-slot generate-daily-verse(language="es") pass, unchanged.

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

  let body: { target_month?: string; dry_run?: boolean; theme_track?: string };
  try { body = await req.json(); } catch { return json(400, { error: "invalid_json_body" }); }

  const targetMonth = body.target_month;
  const dryRun = body.dry_run === true;
  const themeTrack = body.theme_track || "general";
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

  // AUTH: require an authenticated staff member with content.generate. The
  // gateway verify_jwt only proves *some* valid JWT (the public anon key
  // satisfies it), and this triggers real dual-AI generation (cost) under the
  // service role -- so confirm the caller is staff, not just anyone.
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

  const dates = daysInMonth(targetMonth);

  // Per-track 12-month dedup.
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  const { data: usedRows, error: usedErr } = await supa
    .from("used_verses").select("verse_ref").eq("theme_track", themeTrack).gte("used_for_date", cutoff.toISOString().slice(0, 10));
  if (usedErr) return json(500, { error: "failed_to_read_used_verses", detail: usedErr.message });
  const usedRefs = new Set((usedRows || []).map((r: { verse_ref: string }) => r.verse_ref));

  // Candidate pool: full eligible pool for 'general', else the track's approved tags.
  let candidates: Array<{ book: string; chapter: number; verse: number; text: string }>;
  if (themeTrack === "general") {
    const { data, error } = await supa.rpc("get_random_kjv_verses", { sample_size: 3000 });
    if (error) return json(500, { error: "failed_to_read_kjv_verses", detail: error.message });
    candidates = data || [];
  } else {
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
      const simScore = similarity(outputA, outputB);
      const agreementStatus = simScore >= AGREEMENT_THRESHOLD ? "agreed" : "disagreed";
      const status = agreementStatus === "agreed" ? "agreed" : "needs_review";

      const { data: slot, error: slotErr } = await supa
        .from("daily_slots")
        .upsert({
          scheduled_date: targetDate,
          theme_track: themeTrack,
          verse_ref: verseRef,
          status,
          ai_output_a: outputA,
          ai_output_b: outputB,
          agreement_status: agreementStatus,
          generated_for_batch_month: `${targetMonth}-01`,
          updated_at: new Date().toISOString(),
        }, { onConflict: "scheduled_date,theme_track" })
        .select().single();

      if (slotErr) results.push({ date: targetDate, verse_ref: verseRef, error: slotErr.message });
      else results.push({ date: targetDate, verse_ref: verseRef, agreement_status: agreementStatus, slot_status: status, daily_slot_id: slot.id });
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
