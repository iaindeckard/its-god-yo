import "server-only";
import { getSupabaseAdmin } from "./supabaseAdmin";

export type AiFeature = "marketing_analyst" | "bounty_assessment" | "outreach_discovery";

// gpt-5-mini: $0.25/M input, $0.025/M cached input, $2/M output.
// Web search is $10/1,000 calls. Values below are micro-US-dollars.
const INPUT_MICRO_PER_TOKEN = 0.25;
const CACHED_INPUT_MICRO_PER_TOKEN = 0.025;
const OUTPUT_MICRO_PER_TOKEN = 2;
const WEB_SEARCH_MICRO_PER_CALL = 10_000;

export const ANALYST_MAX_OUTPUT_TOKENS = 4_000;
export const ANALYST_MAX_WEB_SEARCHES = 8;
export const ANALYST_MAX_COST_MICROUSD = 100_000; // conservative $0.10 reservation
export const BOUNTY_MAX_OUTPUT_TOKENS = 800;
export const BOUNTY_MAX_COST_MICROUSD = 5_000; // conservative $0.005 reservation
export const DISCOVERY_ROUND_MAX_COST_MICROUSD = 60_000; // 5-search, two-candidate round
export const DISCOVERY_LEGACY_MAX_COST_MICROUSD = 200_000;

interface UsageEvent { id: string; status: "reserved" | "completed" | "failed" }
interface OpenAIUsage {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
  output_tokens_details?: { reasoning_tokens?: number };
}

export async function reserveAiUsage(args: {
  feature: AiFeature; requestKey: string; model: string; maxCostMicrousd: number; metadata?: Record<string, unknown>;
}): Promise<UsageEvent> {
  const { data, error } = await getSupabaseAdmin().rpc("reserve_ai_usage", {
    p_feature: args.feature,
    p_request_key: args.requestKey,
    p_model: args.model,
    p_reserved_cost_microusd: args.maxCostMicrousd,
    p_metadata: args.metadata ?? {},
  });
  if (error) {
    if (error.message.includes("ai_monthly_budget_exceeded")) throw new Error("AI monthly budget reached. Increase the cap before running another request.");
    if (error.message.includes("ai_request_already_exists")) throw new Error("This AI request is already running or has already completed.");
    throw new Error(`ai_usage_reservation_failed: ${error.message}`);
  }
  const event = data as unknown as UsageEvent;
  if (event.status !== "reserved") throw new Error("This AI request has already been processed.");
  return event;
}

export function responseUsage(response: { usage?: OpenAIUsage; output?: Array<{ type?: string }> }) {
  const usage = response.usage ?? {};
  const cached = usage.input_tokens_details?.cached_tokens ?? 0;
  const input = Math.max(0, (usage.input_tokens ?? 0) - cached);
  const output = usage.output_tokens ?? 0;
  const searches = (response.output ?? []).filter((item) => item.type === "web_search_call").length;
  const cost = Math.ceil(input * INPUT_MICRO_PER_TOKEN + cached * CACHED_INPUT_MICRO_PER_TOKEN + output * OUTPUT_MICRO_PER_TOKEN + searches * WEB_SEARCH_MICRO_PER_CALL);
  return { inputTokens: usage.input_tokens ?? 0, cachedTokens: cached, outputTokens: output, reasoningTokens: usage.output_tokens_details?.reasoning_tokens ?? 0, webSearchCalls: searches, estimatedCostMicrousd: cost };
}

export async function completeAiUsage(eventId: string, response: { id?: string; usage?: OpenAIUsage; output?: Array<{ type?: string }> }) {
  const usage = responseUsage(response);
  const { error } = await getSupabaseAdmin().from("ai_usage_events").update({
    status: "completed", provider_response_id: response.id ?? null,
    estimated_cost_microusd: usage.estimatedCostMicrousd,
    input_tokens: usage.inputTokens, cached_input_tokens: usage.cachedTokens,
    output_tokens: usage.outputTokens, reasoning_tokens: usage.reasoningTokens,
    web_search_calls: usage.webSearchCalls, completed_at: new Date().toISOString(),
  }).eq("id", eventId).eq("status", "reserved");
  if (error) throw new Error(`ai_usage_completion_failed: ${error.message}`);
}

export async function attachAiProviderResponse(eventId: string, providerResponseId: string) {
  const { error } = await getSupabaseAdmin().from("ai_usage_events").update({ provider_response_id: providerResponseId }).eq("id", eventId).eq("status", "reserved");
  if (error) throw new Error(`ai_usage_provider_link_failed: ${error.message}`);
}

export async function completeAiUsageByProviderResponse(providerResponseId: string, response: { id?: string; usage?: OpenAIUsage; output?: Array<{ type?: string }> }) {
  const { data } = await getSupabaseAdmin().from("ai_usage_events").select("id").eq("provider_response_id", providerResponseId).eq("status", "reserved").maybeSingle();
  if (data?.id) await completeAiUsage(data.id, response);
}

export async function failAiUsageByProviderResponse(providerResponseId: string, error: unknown) {
  const { data } = await getSupabaseAdmin().from("ai_usage_events").select("id").eq("provider_response_id", providerResponseId).eq("status", "reserved").maybeSingle();
  if (data?.id) await failAiUsage(data.id, error);
}

export async function failAiUsage(eventId: string, error: unknown) {
  await getSupabaseAdmin().from("ai_usage_events").update({
    status: "failed", error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500), completed_at: new Date().toISOString(),
  }).eq("id", eventId).eq("status", "reserved");
}

export interface AiUsageSummary { month: string; spentMicrousd: number; reservedMicrousd: number; budgetMicrousd: number }

export async function getAiUsageSummary(): Promise<AiUsageSummary> {
  const admin = getSupabaseAdmin();
  const month = new Date().toISOString().slice(0, 7);
  const start = `${month}-01T00:00:00.000Z`;
  const [{ data: policy }, { data: events, error }] = await Promise.all([
    admin.from("ai_usage_policy").select("monthly_budget_microusd").eq("id", true).single(),
    admin.from("ai_usage_events").select("status,reserved_cost_microusd,estimated_cost_microusd").gte("created_at", start).in("status", ["reserved", "completed"]),
  ]);
  if (error) throw new Error(`ai_usage_summary_failed: ${error.message}`);
  let spentMicrousd = 0, reservedMicrousd = 0;
  for (const event of events ?? []) {
    if (event.status === "completed") spentMicrousd += Number(event.estimated_cost_microusd ?? event.reserved_cost_microusd ?? 0);
    else reservedMicrousd += Number(event.reserved_cost_microusd ?? 0);
  }
  return { month, spentMicrousd, reservedMicrousd, budgetMicrousd: Number(policy?.monthly_budget_microusd ?? 0) };
}
