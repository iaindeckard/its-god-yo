import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// ONE-OFF diagnostic, 2026-09-01: re-scan already-generated Spanish daily_slots
// content against the just-fixed Spanish divine-capitalization gate, WITHOUT
// regenerating anything. Reuses the exact judgeFidelity logic from
// generate-daily-verse (copied verbatim, same prompt) so this tests what's
// actually live, not a reimplementation. Read-only against daily_slots -- takes
// {source, rendering} pairs in the request body and returns judge results; does
// not write to the DB itself.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
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

interface Judgement { faithful: boolean; added_claims: string[]; omitted_core: string[]; drift: boolean; divine_lc_pronouns: string[]; }

// Copied verbatim from generate-daily-verse v24 (2026-09-01 Spanish-parity fix).
async function judgeFidelity(apiKey: string, source: string, rendering: string, lang: "en" | "es"): Promise<Judgement> {
  const capitalizationRule = lang === "es"
    ? `SEPARATELY, check ONE capitalization rule (this does NOT affect the fidelity verdict above): our house style capitalizes third-person pronouns/possessives that refer to God -- "Él" (he/him, including after a preposition: en Él, de Él, por Él), "Le" (indirect-object him), "Lo" (direct-object him), and "Su"/"Sus"/"Suyo"/"Suya"/"Suyos"/"Suyas" (his). In the PARAPHRASE, list every lowercase "el", "le", "lo", "su", "sus", "suyo", "suya", "suyos", or "suyas" whose antecedent in THIS verse is clearly Dios, Jesús, or el Señor. This needs judgment: if it refers to a human figure (a king, a disciple, a person in the story) or is a different word entirely (e.g. "el" as the article "the", "lo" as a neuter "the [thing]"), do NOT list it. If none, return [].`
    : `SEPARATELY, check ONE capitalization rule (this does NOT affect the fidelity verdict above): our house style capitalizes pronouns that refer to God -- "He", "Him", "His", "Himself". In the PARAPHRASE, list every lowercase "he", "him", "his", or "himself" whose antecedent in THIS verse is clearly God, Jesus, or the Lord. This needs judgment: if a "he/him/his" refers to a human figure (a king, a disciple, a person in the story), do NOT list it. If none, return [].`;
  const prompt = `You check whether a casual, Gen-Z slang paraphrase of a Bible verse stays TRUE to the source's meaning. The informal, texting-style tone is INTENDED and fine — do NOT penalize slang, casual wording, reordering, changed forms of address (e.g. "O my strength" -> "you're my strength"), collapsing poetic/archaic phrasing into plain words, dropping a liturgical marker like "Selah", or conversational filler ("fr", "no cap", "ngl") — as long as the verse's core meaning is preserved.

Mark it UNFAITHFUL only when it clearly:
- ADDS a substantive claim, promise, or theology NOT in the source, OR
- DROPS or contradicts the source's CORE point, OR
- CHANGES the meaning. In particular:
   • a distinct promise (e.g. "comfort") flattened into a generic one ("support") IS drift; and
   • a specific divine title or covenant name (e.g. "LORD of hosts") reduced to a generic term that loses its meaning (e.g. "the boss", "boss of all", "the man upstairs") IS drift.

Give the paraphrase the benefit of the doubt on style and emphasis; flag ONLY real drift in meaning.

${capitalizationRule}

Source (${lang === "es" ? "Reina-Valera 1909" : "KJV"}): "${source}"
Paraphrase: "${rendering}"

Respond with ONLY compact JSON, no prose, no code fences:
{"faithful": true|false, "added_claims": ["..."], "omitted_core": ["..."], "drift": true|false, "divine_lc_pronouns": ["..."]}`;
  try {
    const raw = await callClaude(apiKey, prompt, 0);
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return { faithful: false, added_claims: ["judge_unparseable"], omitted_core: [], drift: false, divine_lc_pronouns: [] };
    const p = JSON.parse(m[0]);
    return {
      faithful: p.faithful === true,
      added_claims: Array.isArray(p.added_claims) ? p.added_claims.map(String) : [],
      omitted_core: Array.isArray(p.omitted_core) ? p.omitted_core.map(String) : [],
      drift: p.drift === true,
      divine_lc_pronouns: Array.isArray(p.divine_lc_pronouns) ? p.divine_lc_pronouns.map(String) : [],
    };
  } catch (_e) {
    return { faithful: false, added_claims: ["judge_error"], omitted_core: [], drift: false, divine_lc_pronouns: [] };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  let body: { items?: Array<{ id: string; label: string; source: string; rendering: string }> };
  try { body = await req.json(); } catch { return json(400, { error: "invalid_json_body" }); }
  const items = body.items;
  if (!Array.isArray(items) || items.length === 0) return json(400, { error: "items must be a non-empty array" });

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) return json(500, { error: "server_not_configured", detail: "ANTHROPIC_API_KEY not set" });

  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return json(401, { error: "unauthorized" });
  const { data: allowed, error: permErr } = await supa.rpc("has_permission", { p_user_id: user.id, p_permission_key: "content.generate" });
  if (permErr) return json(500, { error: "permission_check_failed", detail: permErr.message });
  if (allowed !== true) return json(403, { error: "forbidden", detail: "missing permission 'content.generate'" });

  // Chunked concurrency (10 at a time) rather than firing all at once.
  const results: Array<{ id: string; label: string; divine_lc_pronouns: string[] }> = [];
  const CHUNK = 10;
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    const chunkResults = await Promise.all(chunk.map(async (it) => {
      const j = await judgeFidelity(anthropicKey, it.source, it.rendering, "es");
      return { id: it.id, label: it.label, divine_lc_pronouns: j.divine_lc_pronouns };
    }));
    results.push(...chunkResults);
  }

  return json(200, { count: results.length, results });
});
