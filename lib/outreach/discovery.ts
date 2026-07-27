import "server-only";
import { OUTREACH } from "./config";
import { insertDiscovered, type DiscoveredLead } from "./leads";

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

Return ONLY a JSON object, no prose, of the form:
{"leads":[{"org_name","city","state","denomination_type","contact_email","phone","website","youth_ministry_signal","source_urls":["..."],"discovery_confidence":"high|medium|low"}]}`;

function userPrompt(): string {
  return `Find up to ${OUTREACH.discoveryTarget} churches or youth organizations in ${OUTREACH.geography} that have an active youth/student ministry and a public general contact email. Follow every rule. For each, capture the general email, phone, website, a short youth_ministry_signal quoting what you found and where, the source URL(s), and a confidence rating.`;
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

export async function runDiscovery(): Promise<DiscoveryResult> {
  const key = process.env.ANTHROPIC_API_KEY || process.env.OUTREACH_ANTHROPIC_KEY;
  if (!key) {
    console.log("[outreach-discovery] ANTHROPIC_API_KEY not set — discovery skipped (no-op).");
    return { ran: false, reason: "no_api_key", found: 0, inserted: 0, skipped: 0, leads: [] };
  }

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
      messages: [{ role: "user", content: userPrompt() }],
    }),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 400);
    throw new Error(`anthropic_${res.status}: ${detail}`);
  }
  const data = (await res.json()) as AnthropicResponse;
  const text = (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n");
  const parsed = extractJson(text);
  if (!parsed) {
    return { ran: true, reason: "unparseable_output", found: 0, inserted: 0, skipped: 0, leads: [] };
  }

  const leads = parsed.leads.filter((l) => l && l.org_name && l.contact_email);
  const { inserted, skipped } = await insertDiscovered(leads);
  return { ran: true, found: leads.length, inserted, skipped, leads };
}
