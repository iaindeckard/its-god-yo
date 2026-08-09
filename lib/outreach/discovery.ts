import "server-only";
import { OUTREACH } from "./config";
import { insertDiscovered, type DiscoveredLead } from "./leads";
import { verifyLeads } from "./verify";
import { geocodeAddress } from "../geocode";
import { haversineMiles, sizeBucket, updateCampaign, type Campaign } from "./campaigns";

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

interface AnthropicContentBlock { type: string; text?: string }
interface AnthropicResponse { content?: AnthropicContentBlock[] }

function extractJson(text: string): { leads: DiscoveredLead[] } | null {
  // Tolerate a ```json fence or surrounding prose.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try {
    const parsed = JSON.parse(candidate);
    if (parsed && Array.isArray(parsed.leads)) return parsed as { leads: DiscoveredLead[] };
  } catch { /* fall through */ }
  return null;
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
  return process.env.ANTHROPIC_API_KEY || process.env.OUTREACH_ANTHROPIC_KEY || null;
}

// Nominatim usage policy is <=1 req/s. Space out the per-lead geocodes (same
// 1.1s throttle the backfill script uses) so a large campaign stays polite.
const GEOCODE_THROTTLE_MS = 1100;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** One Claude web-search discovery call. Returns parsed, minimally-valid leads
 *  (or [] if the model's output couldn't be parsed). Throws on API error. */
async function requestLeads(key: string, prompt: string): Promise<DiscoveredLead[]> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: OUTREACH.discoveryModel,
      max_tokens: 8000,
      system: DISCOVERY_SYSTEM,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 12 }],
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 400);
    throw new Error(`anthropic_${res.status}: ${detail}`);
  }
  const data = (await res.json()) as AnthropicResponse;
  const text = (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n");
  const parsed = extractJson(text);
  if (!parsed) return [];
  return parsed.leads.filter((l) => l && l.org_name && l.contact_email);
}

/** Legacy global-geography discovery (the monthly cron). Non-campaign: leads land
 *  active/needs_review per confidence, no geo/size enrichment. */
export async function runDiscovery(): Promise<DiscoveryResult> {
  const key = apiKey();
  if (!key) {
    console.log("[outreach-discovery] ANTHROPIC_API_KEY not set — discovery skipped (no-op).");
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

/**
 * Campaign-scoped discovery (Phase 1). Loops the web-search call within the
 * campaign's radius until the target count is reached or two consecutive rounds
 * add nothing new — this is how a large area yields a large pool (delivered in
 * batches) while a small radius naturally returns fewer. Each lead is geocoded
 * (best-effort, keyless Nominatim) and, when we can positively place it OUTSIDE
 * the radius, dropped; a lead we can't geocode is kept (the prompt already scoped
 * it to the area, and we can't disprove membership). Attendance -> size_bucket.
 * Leads are inserted 'staged' (never auto-send). Cross-round + cross-campaign
 * de-dup is the existing unique(lower(email)) index (Option A: one lead, one
 * campaign).
 */
export async function runCampaignDiscovery(campaign: Campaign): Promise<CampaignDiscoveryResult> {
  const base = { campaign_id: campaign.id, out_of_radius: 0, rounds: 0 };
  const key = apiKey();
  if (!key) {
    console.log("[outreach-discovery] ANTHROPIC_API_KEY not set — campaign discovery skipped (no-op).");
    return { ran: false, reason: "no_api_key", found: 0, inserted: 0, skipped: 0, leads: [], ...base };
  }

  const target = OUTREACH.discoveryTarget;
  const center = campaign.center_lat != null && campaign.center_lng != null
    ? { lat: campaign.center_lat, lng: campaign.center_lng }
    : null;

  await updateCampaign(campaign.id, { status: "discovering" }).catch(() => {});

  const seen = new Set<string>();      // lowercased emails seen this run (loop de-dup)
  const kept: DiscoveredLead[] = [];   // in-radius, enriched
  const excludeNames: string[] = [];   // org names to tell the model to skip
  let outOfRadius = 0;
  let rounds = 0;
  let emptyStreak = 0;
  // Raised 6 -> 8 alongside the target bump (15 -> 35): a larger target needs more
  // rounds to reach. The emptyStreak<2 guard still stops early when an area is
  // exhausted, so a small area (e.g. New Iberia) won't waste rounds inventing
  // leads. NOTE: leads are only persisted AFTER this loop (insertDiscovered), so
  // the whole loop + geocode + auto-verify must finish inside the route's
  // maxDuration or the run is lost — hence maxDuration was also raised (see route).
  const MAX_ROUNDS = 8;

  while (kept.length < target && rounds < MAX_ROUNDS && emptyStreak < 2) {
    rounds++;
    const batch = await requestLeads(key, campaignPrompt(campaign, target - kept.length, excludeNames));
    let addedThisRound = 0;
    for (const l of batch) {
      const email = l.contact_email?.trim().toLowerCase();
      if (!email || seen.has(email)) continue;
      seen.add(email);
      excludeNames.push(l.org_name);

      // Best-effort geocode of the church's city/state for map plotting + radius
      // membership. A miss leaves coords null and the lead is kept. Throttled to
      // respect Nominatim's <=1 req/s policy.
      const coords = await geocodeAddress({ city: l.city, state: l.state, country: "United States" });
      await sleep(GEOCODE_THROTTLE_MS);
      if (coords && center && haversineMiles(center, coords) > Number(campaign.radius_miles)) {
        outOfRadius++;
        continue; // positively outside the radius -> drop
      }
      kept.push({
        ...l,
        latitude: coords?.lat ?? null,
        longitude: coords?.lng ?? null,
        size_bucket: sizeBucket(l.estimated_attendance),
      });
      addedThisRound++;
    }
    emptyStreak = addedThisRound === 0 ? emptyStreak + 1 : 0;
  }

  const { inserted, skipped } = await insertDiscovered(kept, campaign.id);
  // Auto-verify the just-staged campaign leads (best-effort) so they arrive with a
  // verdict; any that can't be confirmed stay 'unverified' and the send gate holds
  // them until an admin re-verifies or overrides.
  await verifyLeads({ campaignId: campaign.id, onlyUnverified: true }).catch((e) => {
    console.error("[outreach-discovery] campaign verify pass failed (leads remain unverified):", e instanceof Error ? e.message : e);
  });
  await updateCampaign(campaign.id, { status: "ready" }).catch(() => {});
  return { ran: true, found: kept.length, inserted, skipped, leads: kept, ...base, out_of_radius: outOfRadius, rounds };
}
