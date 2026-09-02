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
  discoveryPrimaryProvider,
  extractDiscoveryJson,
  isCreditExhaustedError,
  providerResponsePhase,
  normalizeUsStateCode,
  type DiscoveryProvider,
} from "./discovery-core";
import { anthropicDiscoverLeads, anthropicDiscoveryAvailable, ANTHROPIC_DISCOVERY_MODEL } from "./anthropic-discovery";
import { sendOpsAlert } from "../opsAlert";
import { claimAlert } from "../alertState";
import {
  applyDirectorySourcePolicy,
  directorySourcePrompt,
  discoverySourceLane,
  discoverySourceLaneCount,
  type OfficialChurchDirectory,
} from "./directory-sources";
import {
  applySchoolLeadPolicy,
  schoolDiscoverySystem,
  schoolSourceLane,
  schoolSourceLaneCount,
  schoolUserPrompt,
} from "./school-sources";
import { isSchoolVariant } from "./templates";
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
  systemPrompt?: string,
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
    // A school campaign supplies its own school-discovery instructions; the church
    // pipeline uses the directory-based system prompt.
    instructions: systemPrompt ?? discoverySystem(directory),
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

/** Apply the shared lead policy pipeline to raw model output. Used for BOTH
 *  providers (OpenAI text-extracted JSON and Anthropic-extracted JSON) so a
 *  failed-over lane is filtered/validated identically to the primary. School
 *  leads use the school policy (drops the CHS-New Iberia exclusion and stamps
 *  entity_type='school'); churches use the directory policy. */
function applyLeadPolicies(rawLeads: unknown[], maxLeads: number | undefined, school: boolean): DiscoveredLead[] {
  const policy = school ? applySchoolLeadPolicy : applyDirectorySourcePolicy;
  return boundedProviderItems(rawLeads as DiscoveredLead[], maxLeads)
    .filter((l) => l && l.org_name && l.contact_email)
    .map(policy)
    .filter((lead): lead is DiscoveredLead => Boolean(lead))
    .map(applyAttendanceSourcePolicy);
}

function parseResponseLeads(data: OpenAIResponse, maxLeads?: number, school = false): DiscoveredLead[] {
  const text = data.output_text ?? (data.output ?? []).flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text").map((item) => item.text ?? "").join("\n");
  const parsed = extractDiscoveryJson(text);
  if (!parsed) return [];
  return applyLeadPolicies(parsed.leads, maxLeads, school);
}

/**
 * Discovery provider failover (spec: DiscoveryAgentProviderFailover). The PRIMARY
 * provider (OUTREACH_DISCOVERY_PRIMARY; default OpenAI) runs each lane. If it
 * returns a credit-exhaustion error, the CURRENT lane is retried on the OTHER
 * provider instead of aborting the run — either direction (OpenAI<->Anthropic).
 * Every failover is logged; one ops-alert email is sent per drained provider per
 * 6h (deduped via the alert-state channel, so a long dry spell doesn't email
 * per-lane). Each attempt is recorded in the AI-usage ledger.
 */
const FAILOVER_ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

async function alertFailover(from: DiscoveryProvider, to: DiscoveryProvider, laneLabel: string, context: string): Promise<void> {
  console.warn(`[outreach-discovery] FAILOVER ${from}->${to} lane="${laneLabel}" (${context}); ${from} credit exhausted, retrying on ${to}`);
  try {
    const shouldEmail = await claimAlert(getSupabaseAdmin(), {
      alertType: "discovery_provider_failover", entityKey: from,
      cooldownMs: FAILOVER_ALERT_COOLDOWN_MS,
      message: `${from} discovery credit exhausted; failing over to ${to}.`,
    });
    if (shouldEmail) {
      await sendOpsAlert({
        subject: `IGY discovery failover: ${from} to ${to} (credit exhausted)`,
        text: `Discovery failed over from ${from} to ${to}.\nFirst context: ${context}\nLane: ${laneLabel}\nReason: ${from} returned a credit-exhaustion error. The run continued on ${to}. Top up ${from} credits. Further failovers in the next 6h are logged but not re-emailed.`,
      });
    }
  } catch (e) {
    console.error("[outreach-discovery] failover alert failed (continuing):", e instanceof Error ? e.message : e);
  }
}

/** Run ONE lane synchronously on Anthropic (web search + extract). Reserves and
 *  completes a usage event; returns policy-applied leads. No alert — the caller
 *  alerts only when this runs as a failover. */
async function anthropicLane(opts: {
  system: string; prompt: string; maxLeads: number | undefined; school: boolean;
  requestKey: string; maxCostMicrousd: number;
}): Promise<DiscoveredLead[]> {
  const usage = await reserveAiUsage({ feature: "outreach_discovery", requestKey: opts.requestKey, model: ANTHROPIC_DISCOVERY_MODEL, maxCostMicrousd: opts.maxCostMicrousd, metadata: { provider: "anthropic", request_key: opts.requestKey } });
  try {
    const result = await anthropicDiscoverLeads({ system: opts.system, prompt: opts.prompt });
    await completeAiUsage(usage.id, { usage: result.usage }).catch(() => {});
    return applyLeadPolicies(result.leads, opts.maxLeads, opts.school);
  } catch (error) {
    await failAiUsage(usage.id, error);
    throw error;
  }
}

/** Run ONE lane synchronously (FOREGROUND) on OpenAI. Used when OpenAI is the
 *  RESERVE provider (Anthropic-primary mode) and for the legacy cron — the durable
 *  background/poll path is used only when OpenAI is PRIMARY. Reserves and completes
 *  usage; returns policy-applied leads. No alert. */
async function openaiForegroundLane(opts: {
  key: string; system?: string; prompt: string; directory?: OfficialChurchDirectory | null;
  maxLeads: number | undefined; school: boolean; requestKey: string; maxCostMicrousd: number;
}): Promise<DiscoveredLead[]> {
  const usage = await reserveAiUsage({ feature: "outreach_discovery", requestKey: opts.requestKey, model: OUTREACH.openaiDiscoveryModel, maxCostMicrousd: opts.maxCostMicrousd, metadata: { provider: "openai", request_key: opts.requestKey } });
  try {
    const data = await openAIRequest(opts.key, "https://api.openai.com/v1/responses", {
      method: "POST",
      body: JSON.stringify(leadRequestBody(opts.prompt, false, opts.directory, opts.maxLeads, opts.system)),
    }, DISCOVERY_REQUEST_TIMEOUT_MS);
    await completeAiUsage(usage.id, data);
    return parseResponseLeads(data, opts.maxLeads, opts.school);
  } catch (error) {
    await failAiUsage(usage.id, error);
    throw error;
  }
}

/** One synchronous web-search call for the legacy monthly cron, honoring the
 *  primary/reserve provider order (both providers run FOREGROUND here). */
async function requestLeads(openaiKey: string | null, prompt: string): Promise<DiscoveredLead[]> {
  const primary = discoveryPrimaryProvider();
  const system = discoverySystem(undefined);
  const context = "legacy monthly cron (global geography)";
  const laneLabel = "legacy global cron";
  const runAnthropic = (suffix: string) => anthropicLane({
    system, prompt, maxLeads: undefined, school: false,
    requestKey: `outreach_discovery:legacy:${suffix}:${crypto.randomUUID()}`,
    maxCostMicrousd: DISCOVERY_LEGACY_MAX_COST_MICROUSD,
  });
  const runOpenai = (suffix: string) => openaiForegroundLane({
    key: openaiKey!, prompt, directory: undefined, maxLeads: undefined, school: false,
    requestKey: `outreach_discovery:legacy:${suffix}:${crypto.randomUUID()}`,
    maxCostMicrousd: DISCOVERY_LEGACY_MAX_COST_MICROUSD,
  });

  if (primary === "anthropic") {
    try {
      return await runAnthropic("anthropic");
    } catch (error) {
      if (isCreditExhaustedError(error) && openaiKey) {
        await alertFailover("anthropic", "openai", laneLabel, context);
        return await runOpenai("failover:openai");
      }
      throw error;
    }
  }
  try {
    return await runOpenai("openai");
  } catch (error) {
    if (isCreditExhaustedError(error) && anthropicDiscoveryAvailable()) {
      await alertFailover("openai", "anthropic", laneLabel, context);
      return await runAnthropic("failover:anthropic");
    }
    throw error;
  }
}

async function startBackgroundLeadRequest(
  key: string,
  prompt: string,
  directory: OfficialChurchDirectory | null,
  maxLeads: number,
  systemPrompt?: string,
): Promise<OpenAIResponse> {
  return openAIRequest(key, "https://api.openai.com/v1/responses", {
    method: "POST",
    body: JSON.stringify(leadRequestBody(prompt, true, directory, maxLeads, systemPrompt)),
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
  const openaiKey = apiKey();
  const primary = discoveryPrimaryProvider();
  // Only the PRIMARY provider's key is required; the reserve is optional (no
  // failover if it's absent).
  if (primary === "anthropic" ? !anthropicDiscoveryAvailable() : !openaiKey) {
    console.log(`[outreach-discovery] primary provider '${primary}' key not set — discovery skipped (no-op).`);
    return { ran: false, reason: "no_api_key", found: 0, inserted: 0, skipped: 0, leads: [] };
  }
  const leads = await requestLeads(openaiKey, userPrompt());
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
  const sourceLaneCount = isSchoolVariant(campaign.message_variant)
    ? schoolSourceLaneCount(campaign.state_code)
    : discoverySourceLaneCount(campaign.denomination_filter);
  const targetCount = campaign.discovery_target_count ?? OUTREACH.discoveryTarget;
  const { data, error } = await admin.from(RUNS_TABLE).insert({
    campaign_id: campaign.id,
    target_count: targetCount,
    max_rounds: boundedDiscoveryMaxRounds(targetCount, LEADS_PER_ROUND, sourceLaneCount),
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
  const openaiKey = apiKey();
  const primary = discoveryPrimaryProvider();
  // Require only the PRIMARY provider's key; the reserve is optional.
  if (primary === "anthropic") {
    if (!anthropicDiscoveryAvailable()) throw new Error("ANTHROPIC_API_KEY is not configured (discovery primary=anthropic)");
  } else if (!openaiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  let run = await createDiscoveryRun(campaign);
  if (["completed", "failed"].includes(run.status)) return run;
  const claimed = await claimRun(run);
  if (!claimed) return (await latestDiscoveryRun(campaign.id)) ?? run;
  run = claimed;
  const center = campaign.center_lat != null && campaign.center_lng != null
    ? { lat: campaign.center_lat, lng: campaign.center_lng } : null;
  const school = isSchoolVariant(campaign.message_variant);
  try {
    const remaining = Math.max(1, run.target_count - run.found_count);
    const roundTarget = Math.min(LEADS_PER_ROUND, remaining);
    // This round's lane, prompt, and system prompt — shared by both providers so
    // whichever runs searches the exact same sources with the same rules. Computed
    // up front (before the poll/start split) because it is deterministic from the
    // run's round_count + discovered_names snapshot, and the OpenAI background-
    // failure failover below needs it even on a POLL invocation (which never enters
    // the start-a-lane branch). All pure computation — no network.
    const churchLane = school ? null : discoverySourceLane(run.round_count, campaign.denomination_filter);
    const laneLabel = school
      ? schoolSourceLane(run.round_count, campaign.state_code).label
      : churchLane!.label;
    const roundPrompt = school
      ? schoolUserPrompt(campaign.state_code, roundTarget, run.discovered_names, laneLabel)
      : campaignPrompt(campaign, roundTarget, run.discovered_names, laneLabel);
    const roundSystem = school
      ? schoolDiscoverySystem(campaign.state_code)
      : discoverySystem(churchLane?.directory ?? null);
    const directory = churchLane?.directory ?? null;
    // church lanes use the directory-based default system inside the request body;
    // school lanes pass the school system prompt explicitly.
    const openaiSystem = school ? roundSystem : undefined;
    const context = `campaign ${campaign.id} run ${run.id} round ${run.round_count}`;
    const baseKey = `outreach_discovery:${run.id}:round:${run.round_count}`;
    let providerResponse: OpenAIResponse | null = null;
    // Set when this lane ran on a SYNCHRONOUS provider — its already-policy-applied
    // leads, produced inline in this same invocation. Anthropic has no background/
    // poll mode, so an Anthropic lane (primary or reserve) and an OpenAI reserve
    // lane both complete here rather than being polled across invocations.
    let failoverBatch: DiscoveredLead[] | null = null;

    if (run.provider_response_id) {
      // Polling an in-flight OpenAI background job (only OpenAI-primary sets this).
      if (!openaiKey) throw new Error("OPENAI_API_KEY missing while polling an OpenAI background job");
      providerResponse = await retrieveBackgroundLeadRequest(openaiKey, run.provider_response_id);
      run = await patchRun(run.id, { provider_status: providerResponse.status ?? null });
    } else {
      if (primary === "openai") {
        // OpenAI primary: durable background start/poll. Reserve = Anthropic (sync).
        const usageEvent = await reserveAiUsage({ feature: "outreach_discovery", requestKey: baseKey, model: OUTREACH.openaiDiscoveryModel, maxCostMicrousd: DISCOVERY_ROUND_MAX_COST_MICROUSD, metadata: { campaign_id: campaign.id, run_id: run.id, round: run.round_count, provider: "openai" } });
        try {
          providerResponse = await startBackgroundLeadRequest(openaiKey!, roundPrompt, directory, roundTarget, openaiSystem);
        } catch (error) {
          await failAiUsage(usageEvent.id, error);
          if (isCreditExhaustedError(error) && anthropicDiscoveryAvailable()) {
            await alertFailover("openai", "anthropic", laneLabel, context);
            failoverBatch = await anthropicLane({ system: roundSystem, prompt: roundPrompt, maxLeads: roundTarget, school, requestKey: `${baseKey}:failover:anthropic`, maxCostMicrousd: DISCOVERY_ROUND_MAX_COST_MICROUSD });
          } else {
            throw error;
          }
        }
        if (failoverBatch === null) {
          if (!providerResponse?.id) {
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
      } else {
        // Anthropic primary: run this lane SYNCHRONOUSLY inline. Reserve = OpenAI
        // (foreground, since the background/poll path is OpenAI-primary only).
        try {
          failoverBatch = await anthropicLane({ system: roundSystem, prompt: roundPrompt, maxLeads: roundTarget, school, requestKey: baseKey, maxCostMicrousd: DISCOVERY_ROUND_MAX_COST_MICROUSD });
        } catch (error) {
          if (isCreditExhaustedError(error) && openaiKey) {
            await alertFailover("anthropic", "openai", laneLabel, context);
            failoverBatch = await openaiForegroundLane({ key: openaiKey, system: openaiSystem, prompt: roundPrompt, directory, maxLeads: roundTarget, school, requestKey: `${baseKey}:failover:openai`, maxCostMicrousd: DISCOVERY_ROUND_MAX_COST_MICROUSD });
          } else {
            throw error;
          }
        }
      }
    }

    let batch: DiscoveredLead[];
    if (failoverBatch !== null) {
      batch = failoverBatch;
    } else {
      // OpenAI background path: poll the phase, then parse when complete.
      const resp = providerResponse!;
      const phase = providerResponsePhase(resp.status);
      if (phase === "pending") {
        return patchRun(run.id, {
          status: "running",
          provider_status: resp.status ?? null,
        });
      }
      if (phase === "failed") {
        // Keep the code AND message so both isCreditExhaustedError() and a human
        // reading last_error can see what drained. OpenAI reports credit exhaustion
        // as an async background failure whose message is "You have no credits
        // remaining…", frequently with no separate type/code field.
        const detail = [resp.error?.code, resp.error?.message].filter(Boolean).join(": ")
          || resp.incomplete_details?.reason
          || resp.status
          || "unknown";
        const providerError = new Error(`openai_background_${detail}`);
        if (run.provider_response_id) await failAiUsageByProviderResponse(run.provider_response_id, providerError).catch(() => {});
        // A background job can drain OpenAI credits AFTER the POST was accepted, so
        // the synchronous start-time failover (above) never sees it. Fail over HERE
        // too: rerun this exact lane on Anthropic instead of hard-stopping the run.
        if (isCreditExhaustedError(providerError) && anthropicDiscoveryAvailable()) {
          await alertFailover("openai", "anthropic", laneLabel, context);
          // Drop the dead OpenAI response id so no later poll re-polls a failed job.
          run = await patchRun(run.id, { provider_response_id: null, provider_status: null });
          batch = await anthropicLane({
            system: roundSystem, prompt: roundPrompt, maxLeads: roundTarget, school,
            requestKey: `${baseKey}:bgfailover:anthropic`, maxCostMicrousd: DISCOVERY_ROUND_MAX_COST_MICROUSD,
          });
        } else {
          throw providerError;
        }
      } else {
        if (resp.id) await completeAiUsageByProviderResponse(resp.id, resp);
        batch = parseResponseLeads(resp, LEADS_PER_ROUND, school);
      }
    }
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
        size_bucket: sizeBucket(lead.estimated_attendance),
        entity_type: school ? ("school" as const) : lead.entity_type ?? null };
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
      emptyStreakLimit: school
        ? schoolSourceLaneCount(campaign.state_code)
        : discoverySourceLaneCount(campaign.denomination_filter),
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
