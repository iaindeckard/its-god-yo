import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// Daily verse generation. FIXED 2026-07-20: candidate verse pool now comes
// from get_random_kjv_verses() (a real server-side random sample via
// ORDER BY random()) instead of an unordered .limit(), which was silently
// returning table-insertion-order rows -- effectively "almost always
// Genesis," caught via the monthly-batch dry-run test. Same underlying bug
// existed here too, just never surfaced because most single-slot tests so
// far used an explicit verse override rather than the random-pick path.
//
// ADDED 2026-07-20: bilingual support via `language` param.
//   language: "en" (default) -> unchanged behavior: pick/override from
//     kjv_verses, English slang prompt, writes ai_output_a/b, agreement_status,
//     status, verse_ref on daily_slots.
//   language: "es" -> does NOT pick a verse. Reuses the SAME verse reference
//     already selected for English on daily_slots for that date (shared-
//     reference architecture), looks up the matching Spanish source row in
//     rv1909_verses (works because rv1909_verses.book uses the same English
//     identifiers as kjv_verses.book), prompts BOTH AIs to translate the real
//     RV1909 Spanish text into Mexican teen slang, and writes the _es columns.
//   The Spanish output is a translation of the actual Spanish source verse --
//   never an English slang translation, never a translation-of-the-translation.

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

  let body: { target_date?: string; verse_book?: string; verse_chapter?: number; verse_verse?: number; language?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_json_body" });
  }

  const targetDate = body.target_date;
  if (!targetDate) return json(400, { error: "target_date is required (YYYY-MM-DD). Single-slot generation only in this version -- full-month batch is a separate function." });

  const language = body.language === "es" ? "es" : "en";

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!anthropicKey) return json(500, { error: "server_not_configured", detail: "ANTHROPIC_API_KEY not set" });
  if (!openaiKey) return json(500, { error: "server_not_configured", detail: "OPENAI_API_KEY not set" });

  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // ==================== SPANISH PATH ====================
  // Reuses the reference already chosen for English; does not pick a verse.
  if (language === "es") {
    const { data: slotRow, error: slotReadErr } = await supa
      .from("daily_slots")
      .select("id, verse_ref")
      .eq("scheduled_date", targetDate)
      .maybeSingle();
    if (slotReadErr) return json(500, { error: "failed_to_read_daily_slot", detail: slotReadErr.message });
    if (!slotRow || !slotRow.verse_ref) {
      return json(409, { error: "no_english_slot_for_date", detail: `No daily_slots row with a verse_ref exists for ${targetDate}. Generate the English verse first -- Spanish reuses that same reference.` });
    }

    const verseRef = slotRow.verse_ref as string;
    // verse_ref format is "<book> <chapter>:<verse>"; book may contain spaces
    // and digits (e.g. "1 Chronicles", "Song of Solomon"). Anchor on the
    // trailing "<chapter>:<verse>" and treat everything before it as the book.
    const m = verseRef.match(/^(.+)\s+(\d+):(\d+)$/);
    if (!m) return json(500, { error: "unparseable_verse_ref", detail: verseRef });
    const book = m[1];
    const chapter = parseInt(m[2], 10);
    const verse = parseInt(m[3], 10);

    const { data: esVerse, error: esErr } = await supa
      .from("rv1909_verses")
      .select("book, chapter, verse, text")
      .eq("book", book).eq("chapter", chapter).eq("verse", verse)
      .maybeSingle();
    if (esErr) return json(500, { error: "failed_to_read_rv1909_verses", detail: esErr.message });
    if (!esVerse) return json(404, { error: "verse_not_found_in_rv1909", detail: `${verseRef} (book="${book}", ${chapter}:${verse}) has no matching row in rv1909_verses.` });

    const prompt = buildPromptEs(verseRef, esVerse.text);

    let outputA: string, outputB: string;
    try {
      [outputA, outputB] = await Promise.all([
        callClaude(anthropicKey, prompt),
        callOpenAI(openaiKey, prompt),
      ]);
    } catch (e) {
      return json(502, { error: "generation_failed", detail: String((e as Error)?.message ?? e) });
    }

    const simScore = similarity(outputA, outputB);
    const agreementStatus = simScore >= AGREEMENT_THRESHOLD ? "agreed" : "disagreed";
    const statusEs = agreementStatus === "agreed" ? "agreed" : "needs_review";

    const { data: updated, error: updErr } = await supa
      .from("daily_slots")
      .update({
        ai_output_a_es: outputA,
        ai_output_b_es: outputB,
        agreement_status_es: agreementStatus,
        status_es: statusEs,
        updated_at: new Date().toISOString(),
      })
      .eq("scheduled_date", targetDate)
      .select()
      .single();
    if (updErr) return json(500, { error: "failed_to_write_daily_slot_es", detail: updErr.message });

    return json(200, {
      status: "generated",
      language: "es",
      verse_ref: verseRef,
      source_table: "rv1909_verses",
      source_text_es: esVerse.text,
      ai_output_a_source: "claude-sonnet-4-6",
      ai_output_a_es: outputA,
      ai_output_b_source: "gpt-4o",
      ai_output_b_es: outputB,
      similarity_score: simScore,
      agreement_status_es: agreementStatus,
      slot_status_es: statusEs,
      daily_slot_id: updated.id,
    });
  }

  // ==================== ENGLISH PATH (unchanged) ====================
  let verseRow: { book: string; chapter: number; verse: number; text: string } | null = null;

  if (body.verse_book && body.verse_chapter && body.verse_verse) {
    const { data, error } = await supa
      .from("kjv_verses")
      .select("book, chapter, verse, text")
      .eq("book", body.verse_book).eq("chapter", body.verse_chapter).eq("verse", body.verse_verse)
      .single();
    if (error || !data) return json(404, { error: "verse_not_found" });
    verseRow = data;
  } else {
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 1);
    const { data: usedRows, error: usedErr } = await supa
      .from("used_verses")
      .select("verse_ref")
      .gte("used_for_date", cutoff.toISOString().slice(0, 10));
    if (usedErr) return json(500, { error: "failed_to_read_used_verses", detail: usedErr.message });
    const usedRefs = new Set((usedRows || []).map((r: { verse_ref: string }) => r.verse_ref));

    // FIXED: genuine random sample via RPC, not an unordered .limit().
    const { data: candidates, error: candErr } = await supa.rpc("get_random_kjv_verses", { sample_size: 1000 });
    if (candErr) return json(500, { error: "failed_to_read_kjv_verses", detail: candErr.message });
    const eligible = (candidates || []).filter((v: { book: string; chapter: number; verse: number }) => !usedRefs.has(`${v.book} ${v.chapter}:${v.verse}`));
    if (eligible.length === 0) return json(500, { error: "no_eligible_verses_in_sample" });
    verseRow = eligible[Math.floor(Math.random() * eligible.length)];
  }

  const verseRef = `${verseRow!.book} ${verseRow!.chapter}:${verseRow!.verse}`;
  const prompt = buildPromptEn(verseRef, verseRow!.text);

  let outputA: string, outputB: string;
  try {
    [outputA, outputB] = await Promise.all([
      callClaude(anthropicKey, prompt),
      callOpenAI(openaiKey, prompt),
    ]);
  } catch (e) {
    return json(502, { error: "generation_failed", detail: String((e as Error)?.message ?? e) });
  }

  const simScore = similarity(outputA, outputB);
  const agreementStatus = simScore >= AGREEMENT_THRESHOLD ? "agreed" : "disagreed";
  const status = agreementStatus === "agreed" ? "agreed" : "needs_review";

  const { data: slot, error: slotErr } = await supa
    .from("daily_slots")
    .upsert({
      scheduled_date: targetDate,
      verse_ref: verseRef,
      status,
      ai_output_a: outputA,
      ai_output_b: outputB,
      agreement_status: agreementStatus,
      updated_at: new Date().toISOString(),
    }, { onConflict: "scheduled_date" })
    .select()
    .single();
  if (slotErr) return json(500, { error: "failed_to_write_daily_slot", detail: slotErr.message });

  return json(200, {
    status: "generated",
    language: "en",
    verse_ref: verseRef,
    ai_output_a_source: "claude-sonnet-4-6",
    ai_output_a: outputA,
    ai_output_b_source: "gpt-4o",
    ai_output_b: outputB,
    similarity_score: simScore,
    agreement_status: agreementStatus,
    slot_status: status,
    daily_slot_id: slot.id,
  });
});
