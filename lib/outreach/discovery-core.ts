import type { DiscoveredLead } from "./leads";

export function boundedDiscoveryMaxRounds(target: number, leadsPerRound: number, sourceLaneCount: number): number {
  const safeLeadsPerRound = Math.max(1, Math.floor(leadsPerRound));
  return Math.max(1, Math.min(20, Math.ceil(Math.max(0, target) / safeLeadsPerRound) + sourceLaneCount));
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
