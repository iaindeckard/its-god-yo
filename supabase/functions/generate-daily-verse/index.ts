import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// Daily verse generation (single slot). FIXED 2026-07-20: candidate verse pool
// comes from get_random_kjv_verses() (real server-side random sample).
//
// ADDED 2026-07-20: bilingual support via `language` param (en default / es).
//   es does NOT pick a verse — it reuses the reference already chosen for the
//   SAME (date, theme_track) slot and translates the RV1909 source.
//
// ADDED 2026-07-22: theme/mood tracks via `theme_track` param (default
// "general"). daily_slots is now one row per (scheduled_date, theme_track).
//   - "general": unchanged — random from the full eligible KJV pool.
//   - a themed track: the candidate pool is the track's APPROVED
//     verse_theme_tags only (AI-proposed + human-approved). Dedup (used_verses)
//     is per-track. Everything downstream (dual-AI translate, agreement,
//     completeness, review) is identical to general.

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

function endsWithTerminalPunctuation(text: string): boolean {
  return /[.!?]["')]?$/.test(text.trim());
}

// verse_ref format is "<book> <chapter>:<verse>"; book may contain spaces/digits.
function parseVerseRef(ref: string): { book: string; chapter: number; verse: number } | null {
  const m = ref.match(/^(.+)\s+(\d+):(\d+)$/);
  if (!m) return null;
  return { book: m[1], chapter: parseInt(m[2], 10), verse: parseInt(m[3], 10) };
}

function buildPromptEn(verseRef: string, verseText: string): string {
  return `Translate this Bible verse (KJV) into language a teenager would actually text a friend -- current, authentic slang, but respectful of the meaning. Keep it short, like a real text message. Do not add commentary, just the translated verse.

Reference: ${verseRef}
KJV text: "${verseText}"

Respond with ONLY the translated verse text, nothing else.`;
}

function buildPromptEs(verseRef: string, verseText: string): string {
  return `Traduce este versículo bíblico (Reina-Valera 1909) al lenguaje que un adolescente mexicano realmente le enviaría a un amigo por mensaje de texto -- jerga actual y auténtica, pero respetuosa del significado. Que sea corto, como un mensaje de texto real. No agregues comentarios, solo el versículo traducido.

Referencia: ${verseRef}
Texto RV1909: "${verseText}"

Responde SOLO con el texto del versículo traducido, nada más.`;
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

  // ==================== SPANISH PATH ====================
  // Reuses the reference already chosen for the SAME (date, theme_track) slot.
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

    const simScore = similarity(outputA, outputB);
    const agreementStatus = simScore >= AGREEMENT_THRESHOLD ? "agreed" : "disagreed";
    const reasons: string[] = [];
    if (agreementStatus === "disagreed") reasons.push("ai_disagreement");
    if (!endsWithTerminalPunctuation(esVerse.text)) reasons.push("incomplete_sentence");
    const statusEs = reasons.length > 0 ? "needs_review" : "agreed";

    const { data: updated, error: updErr } = await supa
      .from("daily_slots")
      .update({
        ai_output_a_es: outputA,
        ai_output_b_es: outputB,
        agreement_status_es: agreementStatus,
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
      ai_output_a_es: outputA, ai_output_b_es: outputB, similarity_score: simScore,
      agreement_status_es: agreementStatus, slot_status_es: statusEs, needs_review_reasons_es: reasons,
      daily_slot_id: updated.id,
    });
  }

  // ==================== ENGLISH PATH ====================
  let verseRow: { book: string; chapter: number; verse: number; text: string } | null = null;

  if (body.verse_book && body.verse_chapter && body.verse_verse) {
    // Explicit override — theme_track only affects which slot the row lands in.
    const { data, error } = await supa
      .from("kjv_verses").select("book, chapter, verse, text")
      .eq("book", body.verse_book).eq("chapter", body.verse_chapter).eq("verse", body.verse_verse).single();
    if (error || !data) return json(404, { error: "verse_not_found" });
    verseRow = data;
  } else {
    // Per-track dedup: verses used by THIS track in the last 12 months.
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 1);
    const { data: usedRows, error: usedErr } = await supa
      .from("used_verses").select("verse_ref").eq("theme_track", themeTrack).gte("used_for_date", cutoff.toISOString().slice(0, 10));
    if (usedErr) return json(500, { error: "failed_to_read_used_verses", detail: usedErr.message });
    const usedRefs = new Set((usedRows || []).map((r: { verse_ref: string }) => r.verse_ref));

    if (themeTrack === "general") {
      // Full eligible pool, random sample.
      const { data: candidates, error: candErr } = await supa.rpc("get_random_kjv_verses", { sample_size: 1000 });
      if (candErr) return json(500, { error: "failed_to_read_kjv_verses", detail: candErr.message });
      const eligible = (candidates || []).filter((v: { book: string; chapter: number; verse: number }) => !usedRefs.has(`${v.book} ${v.chapter}:${v.verse}`));
      if (eligible.length === 0) return json(500, { error: "no_eligible_verses_in_sample" });
      verseRow = eligible[Math.floor(Math.random() * eligible.length)];
    } else {
      // Themed track: only APPROVED tags for this track (with source text).
      const { data: pool, error: poolErr } = await supa.rpc("get_theme_track_pool", { p_track: themeTrack });
      if (poolErr) return json(500, { error: "failed_to_read_theme_pool", detail: poolErr.message });
      const eligible = (pool || []).filter((v: { book: string; chapter: number; verse: number }) => !usedRefs.has(`${v.book} ${v.chapter}:${v.verse}`));
      if (eligible.length === 0) return json(409, { error: "no_approved_verses_for_track", detail: `Track '${themeTrack}' has no approved, un-used verses. Run propose-theme-verses and approve some first.` });
      verseRow = eligible[Math.floor(Math.random() * eligible.length)];
    }
  }

  const verseRef = `${verseRow!.book} ${verseRow!.chapter}:${verseRow!.verse}`;
  const prompt = buildPromptEn(verseRef, verseRow!.text);

  let outputA: string, outputB: string;
  try {
    [outputA, outputB] = await Promise.all([callClaude(anthropicKey, prompt), callOpenAI(openaiKey, prompt)]);
  } catch (e) {
    return json(502, { error: "generation_failed", detail: String((e as Error)?.message ?? e) });
  }

  const simScore = similarity(outputA, outputB);
  const agreementStatus = simScore >= AGREEMENT_THRESHOLD ? "agreed" : "disagreed";
  const reasons: string[] = [];
  if (agreementStatus === "disagreed") reasons.push("ai_disagreement");
  if (!endsWithTerminalPunctuation(verseRow!.text)) reasons.push("incomplete_sentence");
  const status = reasons.length > 0 ? "needs_review" : "agreed";

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
      needs_review_reasons: reasons,
      updated_at: new Date().toISOString(),
    }, { onConflict: "scheduled_date,theme_track" })
    .select()
    .single();
  if (slotErr) return json(500, { error: "failed_to_write_daily_slot", detail: slotErr.message });

  return json(200, {
    status: "generated", language: "en", theme_track: themeTrack, verse_ref: verseRef,
    ai_output_a: outputA, ai_output_b: outputB, similarity_score: simScore,
    agreement_status: agreementStatus, slot_status: status, needs_review_reasons: reasons,
    daily_slot_id: slot.id,
  });
});
