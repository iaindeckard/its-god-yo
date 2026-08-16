import "server-only";
import { OUTREACH } from "./config";
import { insertDiscovered, type DiscoveredLead } from "./leads";
import { verifyLeads } from "./verify";
import { geocodeAddress } from "../geocode";
import { haversineMiles, sizeBucket, updateCampaign, type Campaign } from "./campaigns";
import { getSupabaseAdmin } from "../supabaseAdmin";
import {
  boundedDiscoveryMaxRounds,
  boundedProviderItems,
  discoveryErrorStatus,
  discoveryIsComplete,
  extractDiscoveryJson,
  providerResponsePhase,
  normalizeUsStateCode,
} from "./discovery-core";
import {
  applyDirectorySourcePolicy,
  directorySourcePrompt,
  discoverySourceLane,
  discoverySourceLaneCount,
  type OfficialChurchDirectory,
} from "./directory-sources";
import { applyAttendanceSourcePolicy, sizeSourcePrompt } from "./size-sources";
import { DISCOVERY_LEGACY_MAX_COST_MICROUSD, DISCOVERY_ROUND_MAX_COST_MICROUSD, attachAiProviderResponse, completeAiUsage, completeAiUsageByProviderResponse, failAiUsage, failAiUsageByProviderResponse, reserveAiUsage } from "../ai-usage";

/**
 * Monthly discovery (spec §4). Calls the OpenAI Responses API with web search and
 * asks for STRUCTURED JSON — a defined search-and-extract pass, not a free-text
 * scrape. The guardrails below are part of the prompt, not left implicit:
 *   - public general/office contact email ONLY — never a personal/staff email,
 *     never a guessed address pattern
 *   - respect robots.txt: if a site blocks automated fetch, rely on the
 *     search-indexed snippet only, don't force it
 *   - official denominational directories are the primary candidate source
 *   - congregation-owned pages qualify the email and active youth signal
 *   - general web search is secondary and can never produce high confidence alone
 *
 * insertDiscovered() then maps confidence + address shape to active vs
 * needs_review and refuses to resurrect any already-known (incl. suppressed) org.
 */

function discoverySystem(directory: OfficialChurchDirectory | null | undefined): string {
  const sourceInstructions = directory
    ? `THIS REQUEST'S ONLY CANDIDATE DIRECTORY:\n- ${directory.denomination}: ${directory.entryUrl}\nSearch this directory only for candidates. Do not search the other national directories in this request.`
    : directory === null
      ? "THIS REQUEST IS THE SECONDARY-WEB FALLBACK. Find candidates from traditions not covered by the configured national directories. Set directory_source_url to null and discovery_method to secondary_web."
      : `OFFICIAL DIRECTORY STARTING POINTS:\n${directorySourcePrompt()}`;
  return `You are a careful research assistant building an outreach lead list of churches and youth organizations. You must follow these NON-NEGOTIABLE rules:

1. Only include an organization that has BOTH (a) a publicly posted, currently-active youth or student ministry, AND (b) a publicly posted GENERAL/OFFICE contact email (e.g. info@, office@, church@). NEVER a personal or individual staff member's email. NEVER an email you guessed or inferred from a pattern — it must appear verbatim on a public page or a search result snippet.
2. Respect robots.txt. If a site disallows automated access, do NOT try to fetch it directly — use only the search-indexed snippet, and lower your confidence for that lead.
3. DISCOVER CANDIDATES FROM OFFICIAL DIRECTORIES FIRST. Search the official national church-body locators listed below before using general web search. An official directory establishes candidate identity and denomination only; it does NOT establish an active youth ministry or contact permission.
4. QUALIFY EACH CANDIDATE ON CONGREGATION-OWNED SOURCES. The public general/office email and current youth-ministry signal must each be supported by the congregation's own website or official social page. Return their URLs separately as contact_source_url and youth_source_url. Never treat a directory entry alone as youth/contact proof.
5. General web search is SECONDARY: use it to locate congregation-owned qualification pages or to find candidates only after the listed official directories do not cover that tradition. For a secondary-web candidate, set directory_source_url to null and discovery_method to "secondary_web". Secondary-web candidates can be at most medium confidence.
6. Do NOT use purchased, scraped, aggregator, map/review, or third-party contact-list data. Respect robots.txt. If a congregation blocks automated access, use only its search-indexed snippet and lower confidence.
7. Every lead MUST cite the specific pages actually used. No un-sourced entries.
8. Prefer quality over quantity. It is correct to return fewer, well-sourced leads than to pad the list. If youth-ministry evidence is weak, stale, or only inferred, mark confidence "low" and say why in youth_ministry_signal.
9. Church SIZE: use the size-source rules below. Capture a stated weekly attendance / average worship-service size as estimated_attendance (an integer) and cite the exact page as attendance_source_url. NEVER guess or infer attendance from building size, staff count, denomination, ranking, or the fact that a church appears on a list. If no numeric public figure is stated, return estimated_attendance: null and attendance_source_url: null.

${sizeSourcePrompt()}

${sourceInstructions}

Return ONLY a JSON object, no prose, of the form:
{"leads":[{"org_name","city","state","denomination_type","contact_email","phone","website","youth_ministry_signal","directory_source_url":"..." or null,"contact_source_url":"...","youth_source_url":"...","discovery_method":"official_directory|secondary_web","source_urls":["..."],"discovery_confidence":"high|medium|low","estimated_attendance":123 or null,"attendance_source_url":"..." or null}]}`;
}

/** Legacy global-geography prompt (the monthly cron, non-campaign). */
function userPrompt(): string {
  return `Find up to ${OUTREACH.discoveryTarget} churches or youth organizations in ${OUTREACH.geography}. Start with the listed official directories, then qualify each candidate on congregation-owned sources. Follow every rule and return every required evidence field.`;
}

/** Campaign-scoped prompt: search within a radius of the campaign's center, and
 *  exclude organizations already found in earlier loop rounds so each round adds
 *  new leads instead of repeating. */
function campaignPrompt(campaign: Campaign, target: number, exclude: string[], sourceLabel: string): string {
  const excludeLine = exclude.length
    ? ` Do NOT include any of these organizations already found: ${exclude.slice(0, 60).join("; ")}.`
    : "";
  const geography = campaign.geography_type === "state"
    ? `in the state of ${campaign.center_label} (${campaign.state_code})`
    : `within ${campaign.radius_miles} miles of ${campaign.center_label}`;
  return `Find up to ${target} churches or youth organizations located ${geography}. Use only this candidate source lane: ${sourceLabel}. Qualify each candidate on congregation-owned sources. Follow every rule and return every required evidence field.${excludeLine}`;
}

interface OpenAIResponse {
  id?: string;
  status?: string;
  error?: { message?: string; code?: string } | null;
  incomplete_details?: { reason?: string } | null;
  output_text?: string;
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number }; output_tokens_details?: { reasoning_tokens?: number } };
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
// The legacy monthly cron still performs one synchronous request. Campaign
// discovery uses short background start/poll requests below so its provider work
// is not coupled to a browser or Vercel request lifetime.
const DISCOVERY_REQUEST_TIMEOUT_MS = 135_000;
const BACKGROUND_REQUEST_TIMEOUT_MS = 15_000;
// A two-lead structured payload is small. Capping output prevents OpenAI from
// reserving the model's much larger default maximum against organization TPM.
const DISCOVERY_MAX_OUTPUT_TOKENS = 4_000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function leadRequestBody(
  prompt: string,
  background = false,
  directory?: OfficialChurchDirectory | null,
  maxLeads?: number,
): Record<string, unknown> {
  const leadProperties = {
    org_name: { type: "string" }, city: { type: "string" }, state: { type: "string" },
    denomination_type: { type: ["string", "null"] }, contact_email: { type: "string" },
    phone: { type: ["string", "null"] }, website: { type: ["string", "null"] },
    youth_ministry_signal: { type: "string" }, source_urls: { type: "array", items: { type: "string" } },
    directory_source_url: { type: ["string", "null"] }, contact_source_url: { type: "string" },
    youth_source_url: { type: "string" },
    discovery_method: { type: "string", enum: ["official_directory", "secondary_web"] },
    discovery_confidence: { type: "string", enum: ["high", "medium", "low"] },
    estimated_attendance: { type: ["integer", "null"] }, attendance_source_url: { type: ["string", "null"] },
  };
  return {
    model: OUTREACH.openaiDiscoveryModel,
    store: false,
    background,
    instructions: discoverySystem(directory),
    input: prompt,
    max_output_tokens: DISCOVERY_MAX_OUTPUT_TOKENS,
    max_tool_calls: background ? 5 : 15,
    reasoning: { effort: "low" },
    tools: [{ type: "web_search", search_context_size: "low" }],
    text: { format: { type: "json_schema", name: "church_discovery", strict: true, schema: {
      type: "object", additionalProperties: false, required: ["leads"], properties: {
        leads: { type: "array", ...(maxLeads == null ? {} : { maxItems: maxLeads }),
          items: { type: "object", additionalProperties: false,
          required: Object.keys(leadProperties), properties: leadProperties } },
      },
    } } },
  };
}

async function openAIRequest(
  key: string,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<OpenAIResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        ...init.headers,
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`openai_timeout_${timeoutMs / 1000}s`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 400);
    throw new Error(`openai_${res.status}: ${detail}`);
  }
  return (await res.json()) as OpenAIResponse;
}

function parseResponseLeads(data: OpenAIResponse, maxLeads?: number): DiscoveredLead[] {
  const text = data.output_text ?? (data.output ?? []).flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text").map((item) => item.text ?? "").join("\n");
  const parsed = extractDiscoveryJson(text);
  if (!parsed) return [];
  return boundedProviderItems(parsed.leads, maxLeads)
    .filter((l) => l && l.org_name && l.contact_email)
    .map(applyDirectorySourcePolicy)
    .filter((lead): lead is DiscoveredLead => Boolean(lead))
    .map(applyAttendanceSourcePolicy);
}

/** One synchronous OpenAI web-search call for the legacy monthly cron. */
async function requestLeads(key: string, prompt: string): Promise<DiscoveredLead[]> {
  const usageEvent = await reserveAiUsage({ feature: "outreach_discovery", requestKey: `outreach_discovery:legacy:${crypto.randomUUID()}`, model: OUTREACH.openaiDiscoveryModel, maxCostMicrousd: DISCOVERY_LEGACY_MAX_COST_MICROUSD });
  try {
    const data = await openAIRequest(key, "https://api.openai.com/v1/responses", {
      method: "POST",
      body: JSON.stringify(leadRequestBody(prompt)),
    }, DISCOVERY_REQUEST_TIMEOUT_MS);
    await completeAiUsage(usageEvent.id, data);
    return parseResponseLeads(data);
  } catch (error) {
    await failAiUsage(usageEvent.id, error);
    throw error;
  }
}

async function startBackgroundLeadRequest(
  key: string,
  prompt: string,
  directory: OfficialChurchDirectory | null,
  maxLeads: number,
): Promise<OpenAIResponse> {
  return openAIRequest(key, "https://api.openai.com/v1/responses", {
    method: "POST",
    body: JSON.stringify(leadRequestBody(prompt, true, directory, maxLeads)),
  }, BACKGROUND_REQUEST_TIMEOUT_MS);
}

async function retrieveBackgroundLeadRequest(key: string, responseId: string): Promise<OpenAIResponse> {
  return openAIRequest(
    key,
    `https://api.openai.com/v1/responses/${encodeURIComponent(responseId)}`,
    { method: "GET" },
    BACKGROUND_REQUEST_TIMEOUT_MS,
  );
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
  provider_response_id: string | null; provider_status: string | null;
  found_count: number; inserted_count: number; skipped_count: number; out_of_radius_count: number;
  empty_streak: number; discovered_names: string[]; last_error: string | null;
  started_at: string; heartbeat_at: string; completed_at: string | null;
}

const RUNS_TABLE = "outreach_discovery_runs";
const LEADS_PER_ROUND = 2;
// The persisted table enforces max_rounds between 1 and 20. Twenty bounded
// two-lead rounds can still satisfy the default 35-lead target while leaving
// two sparse rounds; larger configured targets finish safely at this ceiling.
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
  const sourceLaneCount = discoverySourceLaneCount(campaign.denomination_filter);
  const { data, error } = await admin.from(RUNS_TABLE).insert({
    campaign_id: campaign.id,
    target_count: OUTREACH.discoveryTarget,
    max_rounds: boundedDiscoveryMaxRounds(OUTREACH.discoveryTarget, LEADS_PER_ROUND, sourceLaneCount),
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

async function claimRun(run: DiscoveryRun): Promise<DiscoveryRun | null> {
  const now = new Date().toISOString();
  let query = getSupabaseAdmin().from(RUNS_TABLE)
    .update({ status: "processing", last_error: null, heartbeat_at: now, updated_at: now })
    .eq("id", run.id)
    .eq("status", run.status);
  if (run.status === "processing") {
    query = query.lt("heartbeat_at", new Date(Date.now() - STALE_PROCESSING_MS).toISOString());
  }
  const { data, error } = await query.select("*").maybeSingle();
  if (error) throw new Error(`discovery_run_claim_failed: ${error.message}`);
  return data as DiscoveryRun | null;
}

/** Process exactly one durable discovery round. The browser can call this again
 * until complete; every accepted lead is persisted before the round returns. */
export async function continueCampaignDiscovery(campaign: Campaign): Promise<DiscoveryRun> {
  const key = apiKey();
  if (!key) throw new Error("OPENAI_API_KEY is not configured");
  let run = await createDiscoveryRun(campaign);
  if (["completed", "failed"].includes(run.status)) return run;
  const claimed = await claimRun(run);
  if (!claimed) return (await latestDiscoveryRun(campaign.id)) ?? run;
  run = claimed;
  const center = campaign.center_lat != null && campaign.center_lng != null
    ? { lat: campaign.center_lat, lng: campaign.center_lng } : null;
  try {
    const remaining = Math.max(1, run.target_count - run.found_count);
    let providerResponse: OpenAIResponse;
    if (run.provider_response_id) {
      providerResponse = await retrieveBackgroundLeadRequest(key, run.provider_response_id);
      run = await patchRun(run.id, { provider_status: providerResponse.status ?? null });
    } else {
      const lane = discoverySourceLane(run.round_count, campaign.denomination_filter);
      const usageEvent = await reserveAiUsage({ feature: "outreach_discovery", requestKey: `outreach_discovery:${run.id}:round:${run.round_count}`, model: OUTREACH.openaiDiscoveryModel, maxCostMicrousd: DISCOVERY_ROUND_MAX_COST_MICROUSD, metadata: { campaign_id: campaign.id, run_id: run.id, round: run.round_count } });
      try {
        providerResponse = await startBackgroundLeadRequest(
          key,
          campaignPrompt(campaign, Math.min(LEADS_PER_ROUND, remaining), run.discovered_names, lane.label),
          lane.directory,
          Math.min(LEADS_PER_ROUND, remaining),
        );
      } catch (error) {
        await failAiUsage(usageEvent.id, error);
        throw error;
      }
      if (!providerResponse.id) {
        const missingId = new Error("openai_background_missing_id");
        await failAiUsage(usageEvent.id, missingId);
        throw missingId;
      }
      await attachAiProviderResponse(usageEvent.id, providerResponse.id);
      run = await patchRun(run.id, {
        provider_response_id: providerResponse.id,
        provider_status: providerResponse.status ?? null,
      });
    }

    const phase = providerResponsePhase(providerResponse.status);
    if (phase === "pending") {
      return patchRun(run.id, {
        status: "running",
        provider_status: providerResponse.status ?? null,
      });
    }
    if (phase === "failed") {
      const detail = providerResponse.error?.message
        ?? providerResponse.error?.code
        ?? providerResponse.incomplete_details?.reason
        ?? providerResponse.status
        ?? "unknown";
      const providerError = new Error(`openai_background_${detail}`);
      if (run.provider_response_id) await failAiUsageByProviderResponse(run.provider_response_id, providerError);
      throw providerError;
    }

    if (providerResponse.id) await completeAiUsageByProviderResponse(providerResponse.id, providerResponse);

    const batch = parseResponseLeads(providerResponse, LEADS_PER_ROUND);
    let found = run.found_count, inserted = run.inserted_count, skipped = run.skipped_count;
    let outOfRadius = run.out_of_radius_count, added = 0;
    const names = [...run.discovered_names];
    for (const lead of batch) {
      if (names.some((name) => name.toLowerCase() === lead.org_name.toLowerCase())) { skipped++; continue; }
      names.push(lead.org_name);
      const coords = await geocodeAddress({ city: lead.city, state: lead.state, country: "United States" });
      await sleep(GEOCODE_THROTTLE_MS);
      const outsideTarget = campaign.geography_type === "state"
        ? normalizeUsStateCode(lead.state) !== campaign.state_code
        : Boolean(coords && center && haversineMiles(center, coords) > Number(campaign.radius_miles));
      if (outsideTarget) { outOfRadius++; continue; }
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
    const done = discoveryIsComplete({
      found,
      target: run.target_count,
      round,
      maxRounds: run.max_rounds,
      emptyStreak,
      emptyStreakLimit: discoverySourceLaneCount(campaign.denomination_filter),
    });
    run = await patchRun(run.id, {
      status: done ? "completed" : "running", round_count: round, found_count: found,
      inserted_count: inserted, skipped_count: skipped, out_of_radius_count: outOfRadius,
      empty_streak: emptyStreak, discovered_names: names, completed_at: done ? new Date().toISOString() : null,
      provider_response_id: null, provider_status: null,
    });
    if (done) await updateCampaign(campaign.id, { status: "ready" });
    return run;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = discoveryErrorStatus(run.found_count);
    run = await patchRun(run.id, { status, last_error: message.slice(0, 500), completed_at: new Date().toISOString() });
    await updateCampaign(campaign.id, { status: "ready" }).catch(() => {});
    if (status === "completed") return run;
    throw error;
  }
}
