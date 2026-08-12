import "server-only";
import { OUTREACH } from "./config";
import { insertDiscovered, type DiscoveredLead } from "./leads";
import { verifyLeads } from "./verify";
import { geocodeAddress } from "../geocode";
import { haversineMiles, sizeBucket, updateCampaign, type Campaign } from "./campaigns";
import { getSupabaseAdmin } from "../supabaseAdmin";
import { discoveryIsComplete, extractDiscoveryJson } from "./discovery-core";

/**
 * Monthly discovery (spec §4). Calls the Claude API with the web-search tool and
 * asks for STRUCTURED JSON — a defined search-and-extract pass, not a free-text
 * scrape. The guardrails below are part of the prompt, not left implicit:
 *   - public general/office contact email ONLY — never a personal/staff email,
 *     never a guessed address pattern
 *   - respect robots.txt: if a site blocks automated fetch, rely on the
 *     search-indexed snippet only, don't force it
 *   - no purchased/third-party contact-list data — org sites + their own socials
 *   - every lead cites the source URL(s) that actually show the email + youth signal
 *
 * insertDiscovered() then maps confidence + address shape to active vs
 * needs_review and refuses to resurrect any already-known (incl. suppressed) org.
 */

const DISCOVERY_SYSTEM =
`You are a careful research assistant building an outreach lead list of churches and youth organizations. You must follow these NON-NEGOTIABLE rules:

1. Only include an organization that has BOTH (a) a publicly posted, currently-active youth or student ministry, AND (b) a publicly posted GENERAL/OFFICE contact email (e.g. info@, office@, church@). NEVER a personal or individual staff member's email. NEVER an email you guessed or inferred from a pattern — it must appear verbatim on a public page or a search result snippet.
2. Respect robots.txt. If a site disallows automated access, do NOT try to fetch it directly — use only the search-indexed snippet, and lower your confidence for that lead.
3. Use only the organization's own public website/social pages and general web search. Do NOT use any purchased, scraped, or third-party contact-list data.
4. Every lead MUST cite the specific source URL(s) that show the email and the youth-ministry signal. No un-sourced entries. If email and youth signal are on different pages, cite both.
5. Prefer quality over quantity. It is correct to return fewer, well-sourced leads than to pad the list. If youth-ministry evidence is weak, stale, or only inferred, mark confidence "low" and say why in youth_ministry_signal.
6. Church SIZE: if a public page states a weekly attendance / average worship-service size (an "about"/"who we are"/news/annual-report page), capture it as estimated_attendance (an integer) and attendance_source_url (the page it came from). NEVER guess or infer attendance from building size, staff count, or denomination — if no public figure is stated, return estimated_attendance: null and attendance_source_url: null.

Return ONLY a JSON object, no prose, of the form:
{"leads":[{"org_name","city","state","denomination_type","contact_email","phone","website","youth_ministry_signal","source_urls":["..."],"discovery_confidence":"high|medium|low","estimated_attendance":123 or null,"attendance_source_url":"..." or null}]}`;

/** Legacy global-geography prompt (the monthly cron, non-campaign). */
function userPrompt(): string {
  return `Find up to ${OUTREACH.discoveryTarget} churches or youth organizations in ${OUTREACH.geography} that have an active youth/student ministry and a public general contact email. Follow every rule. For each, capture the general email, phone, website, a short youth_ministry_signal quoting what you found and where, the source URL(s), a confidence rating, and (only if publicly stated) estimated_attendance + attendance_source_url.`;
}

/** Campaign-scoped prompt: search within a radius of the campaign's center, and
 *  exclude organizations already found in earlier loop rounds so each round adds
 *  new leads instead of repeating. */
function campaignPrompt(campaign: Campaign, target: number, exclude: string[]): string {
  const excludeLine = exclude.length
    ? ` Do NOT include any of these organizations already found: ${exclude.slice(0, 60).join("; ")}.`
    : "";
  return `Find up to ${target} churches or youth organizations located within ${campaign.radius_miles} miles of ${campaign.center_label} that have an active youth/student ministry and a public general contact email. Follow every rule. For each, capture city and state, the general email, phone, website, a short youth_ministry_signal quoting what you found and where, the source URL(s), a confidence rating, and (only if publicly stated) estimated_attendance + attendance_source_url.${excludeLine}`;
}

interface OpenAIResponse {
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
}

export interface DiscoveryResult {
  ran: boolean;
  reason?: string;
  found: number;
  inserted: number;
  skipped: number;
  leads: DiscoveredLead[];
}

function apiKey(): string | null {
  return process.env.OPENAI_API_KEY || null;
}

// Nominatim usage policy is <=1 req/s. Space out the per-lead geocodes (same
// 1.1s throttle the backfill script uses) so a large campaign stays polite.
const GEOCODE_THROTTLE_MS = 1100;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** One OpenAI web-search discovery call. Returns parsed, minimally-valid leads
 *  (or [] if the model's output couldn't be parsed). Throws on API error. */
async function requestLeads(key: string, prompt: string): Promise<DiscoveredLead[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  const leadProperties = {
    org_name: { type: "string" }, city: { type: "string" }, state: { type: "string" },
    denomination_type: { type: ["string", "null"] }, contact_email: { type: "string" },
    phone: { type: ["string", "null"] }, website: { type: ["string", "null"] },
    youth_ministry_signal: { type: "string" }, source_urls: { type: "array", items: { type: "string" } },
    discovery_confidence: { type: "string", enum: ["high", "medium", "low"] },
    estimated_attendance: { type: ["integer", "null"] }, attendance_source_url: { type: ["string", "null"] },
  };
  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    signal: controller.signal,
    body: JSON.stringify({
      model: OUTREACH.openaiDiscoveryModel,
      store: false,
      instructions: DISCOVERY_SYSTEM,
      input: prompt,
      tools: [{ type: "web_search", search_context_size: "medium" }],
      text: { format: { type: "json_schema", name: "church_discovery", strict: true, schema: {
        type: "object", additionalProperties: false, required: ["leads"], properties: {
          leads: { type: "array", items: { type: "object", additionalProperties: false,
            required: Object.keys(leadProperties), properties: leadProperties } },
        },
      } } },
    }),
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 400);
    throw new Error(`openai_${res.status}: ${detail}`);
  }
  const data = (await res.json()) as OpenAIResponse;
  const text = data.output_text ?? (data.output ?? []).flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text").map((item) => item.text ?? "").join("\n");
  const parsed = extractDiscoveryJson(text);
  if (!parsed) return [];
  return parsed.leads.filter((l) => l && l.org_name && l.contact_email);
}

/** Legacy global-geography discovery (the monthly cron). Non-campaign: leads land
 *  active/needs_review per confidence, no geo/size enrichment. */
export async function runDiscovery(): Promise<DiscoveryResult> {
  const key = apiKey();
  if (!key) {
    console.log("[outreach-discovery] OPENAI_API_KEY not set — discovery skipped (no-op).");
    return { ran: false, reason: "no_api_key", found: 0, inserted: 0, skipped: 0, leads: [] };
  }
  const leads = await requestLeads(key, userPrompt());
  const { inserted, skipped } = await insertDiscovered(leads, null);
  // Auto-verify freshly discovered leads (best-effort). A failure leaves them
  // 'unverified' -> the send gate blocks them until verification runs.
  await verifyLeads({ onlyUnverified: true }).catch((e) => {
    console.error("[outreach-discovery] verify pass failed (leads remain unverified):", e instanceof Error ? e.message : e);
  });
  return { ran: true, found: leads.length, inserted, skipped, leads };
}

export interface CampaignDiscoveryResult extends DiscoveryResult {
  campaign_id: string;
  out_of_radius: number;
  rounds: number;
}

export interface DiscoveryRun {
  id: string; campaign_id: string; status: "running" | "processing" | "completed" | "failed";
  provider: string; target_count: number; max_rounds: number; round_count: number;
  found_count: number; inserted_count: number; skipped_count: number; out_of_radius_count: number;
  empty_streak: number; discovered_names: string[]; last_error: string | null;
  started_at: string; heartbeat_at: string; completed_at: string | null;
}

const RUNS_TABLE = "outreach_discovery_runs";
const MAX_ROUNDS = 8;
const STALE_PROCESSING_MS = 2 * 60 * 1000;

export async function latestDiscoveryRun(campaignId: string): Promise<DiscoveryRun | null> {
  const { data, error } = await getSupabaseAdmin().from(RUNS_TABLE).select("*")
    .eq("campaign_id", campaignId).order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`discovery_run_lookup_failed: ${error.message}`);
  return data as DiscoveryRun | null;
}

async function createDiscoveryRun(campaign: Campaign): Promise<DiscoveryRun> {
  const admin = getSupabaseAdmin();
  const prior = await latestDiscoveryRun(campaign.id);
  if (prior && ["running", "processing"].includes(prior.status)) return prior;
  const { data, error } = await admin.from(RUNS_TABLE).insert({
    campaign_id: campaign.id, target_count: OUTREACH.discoveryTarget, max_rounds: MAX_ROUNDS,
  }).select("*").single();
  if (error) throw new Error(`discovery_run_create_failed: ${error.message}`);
  await updateCampaign(campaign.id, { status: "discovering" });
  return data as DiscoveryRun;
}

async function patchRun(id: string, patch: Record<string, unknown>): Promise<DiscoveryRun> {
  const { data, error } = await getSupabaseAdmin().from(RUNS_TABLE)
    .update({ ...patch, heartbeat_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id).select("*").single();
  if (error) throw new Error(`discovery_run_update_failed: ${error.message}`);
  return data as DiscoveryRun;
}

/** Process exactly one durable discovery round. The browser can call this again
 * until complete; every accepted lead is persisted before the round returns. */
export async function continueCampaignDiscovery(campaign: Campaign): Promise<DiscoveryRun> {
  const key = apiKey();
  if (!key) throw new Error("OPENAI_API_KEY is not configured");
  let run = await createDiscoveryRun(campaign);
  if (["completed", "failed"].includes(run.status)) return run;
  if (run.status === "processing" && Date.now() - new Date(run.heartbeat_at).getTime() < STALE_PROCESSING_MS) return run;

  run = await patchRun(run.id, { status: "processing", last_error: null });
  const center = campaign.center_lat != null && campaign.center_lng != null
    ? { lat: campaign.center_lat, lng: campaign.center_lng } : null;
  try {
    const remaining = Math.max(1, run.target_count - run.found_count);
    const batch = await requestLeads(key, campaignPrompt(campaign, Math.min(5, remaining), run.discovered_names));
    let found = run.found_count, inserted = run.inserted_count, skipped = run.skipped_count;
    let outOfRadius = run.out_of_radius_count, added = 0;
    const names = [...run.discovered_names];
    for (const lead of batch) {
      if (names.some((name) => name.toLowerCase() === lead.org_name.toLowerCase())) { skipped++; continue; }
      names.push(lead.org_name);
      const coords = await geocodeAddress({ city: lead.city, state: lead.state, country: "United States" });
      await sleep(GEOCODE_THROTTLE_MS);
      if (coords && center && haversineMiles(center, coords) > Number(campaign.radius_miles)) { outOfRadius++; continue; }
      const enriched = { ...lead, latitude: coords?.lat ?? null, longitude: coords?.lng ?? null,
        size_bucket: sizeBucket(lead.estimated_attendance) };
      const saved = await insertDiscovered([enriched], campaign.id);
      inserted += saved.inserted; skipped += saved.skipped; found++; added++;
      await patchRun(run.id, { found_count: found, inserted_count: inserted, skipped_count: skipped,
        out_of_radius_count: outOfRadius, discovered_names: names });
      if (saved.insertedIds.length) await verifyLeads({ ids: saved.insertedIds }).catch(() => {});
    }
    const round = run.round_count + 1;
    const emptyStreak = added === 0 ? run.empty_streak + 1 : 0;
    const done = discoveryIsComplete({ found, target: run.target_count, round, maxRounds: run.max_rounds, emptyStreak });
    run = await patchRun(run.id, {
      status: done ? "completed" : "running", round_count: round, found_count: found,
      inserted_count: inserted, skipped_count: skipped, out_of_radius_count: outOfRadius,
      empty_streak: emptyStreak, discovered_names: names, completed_at: done ? new Date().toISOString() : null,
    });
    if (done) await updateCampaign(campaign.id, { status: "ready" });
    return run;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await patchRun(run.id, { status: "failed", last_error: message.slice(0, 500), completed_at: new Date().toISOString() });
    await updateCampaign(campaign.id, { status: "ready" }).catch(() => {});
    throw error;
  }
}
