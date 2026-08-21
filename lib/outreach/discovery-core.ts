import type { DiscoveredLead } from "./leads";

const US_STATE_CODES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
  connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID",
  illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR",
  pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
  tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "district of columbia": "DC",
};

export function normalizeUsStateCode(value: string | null | undefined): string | null {
  const clean = value?.trim();
  if (!clean) return null;
  if (/^[a-z]{2}$/i.test(clean)) return clean.toUpperCase();
  return US_STATE_CODES[clean.toLowerCase()] ?? null;
}

export function boundedDiscoveryMaxRounds(target: number, leadsPerRound: number, sourceLaneCount: number): number {
  const safeLeadsPerRound = Math.max(1, Math.floor(leadsPerRound));
  return Math.max(1, Math.min(20, Math.ceil(Math.max(0, target) / safeLeadsPerRound) + sourceLaneCount));
}

export function boundedProviderItems<T>(items: T[], limit: number | undefined): T[] {
  if (limit == null) return items;
  return items.slice(0, Math.max(0, Math.floor(limit)));
}

export function extractDiscoveryJson(text: string): { leads: DiscoveredLead[] } | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try {
    const parsed = JSON.parse(candidate);
    if (parsed && Array.isArray(parsed.leads)) return parsed as { leads: DiscoveredLead[] };
  } catch { /* invalid provider output */ }
  return null;
}

export function discoveryIsComplete(input: {
  found: number; target: number; round: number; maxRounds: number; emptyStreak: number;
  emptyStreakLimit?: number;
}): boolean {
  return input.found >= input.target
    || input.round >= input.maxRounds
    || input.emptyStreak >= (input.emptyStreakLimit ?? 2);
}

export function discoveryErrorStatus(found: number): "completed" | "failed" {
  return found > 0 ? "completed" : "failed";
}

export function providerResponsePhase(status: string | null | undefined): "pending" | "completed" | "failed" {
  if (status === "queued" || status === "in_progress") return "pending";
  if (status === "completed") return "completed";
  return "failed";
}

/**
 * True when a provider error means the account is OUT OF CREDITS/QUOTA (as opposed
 * to an ordinary rate limit, which should NOT trigger failover). Matches the
 * specific signals each provider uses:
 *   - OpenAI: type "insufficient_quota" / code "credit_balance_exhausted"
 *     (also "billing_hard_limit_reached")
 *   - Anthropic: HTTP 400 with "credit balance is too low"
 * This is the ONLY error class the discovery failover reacts to — a plain 429
 * rate limit (retry-after) is left to the provider's own backoff, not failed over.
 */
export function isCreditExhaustedError(error: unknown): boolean {
  const msg = (error instanceof Error ? error.message : String(error ?? "")).toLowerCase();
  if (!msg) return false;
  return (
    msg.includes("insufficient_quota") ||
    msg.includes("credit_balance_exhausted") ||
    msg.includes("billing_hard_limit_reached") ||
    msg.includes("credit balance is too low") ||
    msg.includes("credit balance is too low to")
  );
}
