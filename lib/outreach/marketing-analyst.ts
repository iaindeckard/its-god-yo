import "server-only";
import { getSupabaseAdmin } from "../supabaseAdmin";
import { OUTREACH } from "./config";
import { parseMarketingAnalysis, type MarketingAnalysis, type MarketingAnalysisInput } from "./marketing-analysis";
import { ANALYST_MAX_COST_MICROUSD, ANALYST_MAX_OUTPUT_TOKENS, ANALYST_MAX_WEB_SEARCHES, completeAiUsage, failAiUsage, reserveAiUsage } from "../ai-usage";
import { createOpenAIResponse, responseText } from "../openai-responses";

const SYSTEM = `You are the marketing analyst for It's God, Yo!, a paid daily Bible-text product for families and teens. Recommend careful, small, evidence-backed US geographic outreach tests.

NON-NEGOTIABLE:
1. Research current public sources with web search. Every recommended market needs at least two directly relevant source claims and URLs. Never invent demographics, events, dates, organizations, or performance data.
2. Separate sourced evidence from assumptions. Say when IGY first-party conversion data is unavailable.
3. Rank no more than five markets. Prefer a small test over a national blast. Avoid areas recently contacted when noted in the request.
4. Recommend timing, audience, channels, message direction, test size, success metrics, and risks. Do not claim a campaign will succeed.
5. This is a proposal only. Do not instruct the system to send, schedule, promote leads, open a gate, or contact anyone.
6. Use plain, personal language. No em dashes. Do not manipulate fear, faith, minors, or family anxiety.
7. Dallas results are inconclusive when referenced: eight rapid unsubscribes may include security scanners and must not be treated as confirmed human rejection.

Return ONLY JSON with this shape:
{"executive_summary":"...","next_action":"...","data_limitations":["..."],"recommendations":[{"market_name":"...","state":"...","center_label":"City, ST","radius_miles":25,"score":85,"why_now":"...","audience":"...","timing":{"start":"YYYY-MM-DD","end":"YYYY-MM-DD","rationale":"..."},"message":{"theme":"...","value_proposition":"...","call_to_action":"...","subject_line":"...","opening":"..."},"channels":["..."],"test_size":25,"success_metrics":["..."],"risks":["..."],"assumptions":["..."],"evidence":[{"claim":"...","url":"https://..."}]}]}

Scores are transparent prioritization aids, not predictions.`;

function extractObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return JSON.parse(candidate);
}

export async function generateMarketingAnalysis(input: MarketingAnalysisInput, requestKey: string): Promise<MarketingAnalysis> {
  const model = process.env.OUTREACH_OPENAI_MODEL || OUTREACH.openaiDiscoveryModel;
  const usageEvent = await reserveAiUsage({ feature: "marketing_analyst", requestKey, model, maxCostMicrousd: ANALYST_MAX_COST_MICROUSD });
  const today = new Date().toISOString().slice(0, 10);
  const prompt = `Today is ${today}. Objective: ${input.objective}. Audience: ${input.audience}. Budget: ${input.budget_level}. Preferred window: ${input.preferred_window || "recommend one"}. Constraints: ${input.constraints || "none supplied"}. The Dallas outreach gate is closed. New Iberia is operationally blocked and must not be recommended until its discovery status is repaired. Recommend the best next US market tests and explain the evidence.`;
  try {
    const response = await createOpenAIResponse({
      model, instructions: SYSTEM, input: prompt,
      max_output_tokens: ANALYST_MAX_OUTPUT_TOKENS,
      max_tool_calls: ANALYST_MAX_WEB_SEARCHES,
      reasoning: { effort: "low" },
      tools: [{ type: "web_search", search_context_size: "low" }],
    });
    const analysis = parseMarketingAnalysis(extractObject(responseText(response)));
    await completeAiUsage(usageEvent.id, response);
    return analysis;
  } catch (error) {
    await failAiUsage(usageEvent.id, error);
    throw error;
  }
}

export interface MarketingProposalRow extends MarketingAnalysisInput {
  id: string;
  analysis: MarketingAnalysis;
  status: "draft" | "approved" | "rejected";
  campaign_id: string | null;
  created_at: string;
}

export async function saveMarketingProposal(input: MarketingAnalysisInput, analysis: MarketingAnalysis, createdBy: string | null) {
  const { data, error } = await getSupabaseAdmin().from("outreach_marketing_proposals").insert({
    ...input, preferred_window: input.preferred_window || null, constraints: input.constraints || null,
    analysis, created_by: createdBy,
  }).select("*").single();
  if (error) throw new Error(`save_marketing_proposal_failed: ${error.message}`);
  return data as MarketingProposalRow;
}

export async function getMarketingProposal(id: string): Promise<MarketingProposalRow | null> {
  const { data } = await getSupabaseAdmin().from("outreach_marketing_proposals").select("*").eq("id", id).maybeSingle();
  return (data as MarketingProposalRow) ?? null;
}

export async function approveMarketingProposal(id: string, marketIndex: number, campaignId: string, approvedBy: string | null) {
  const { data, error } = await getSupabaseAdmin().from("outreach_marketing_proposals").update({
    status: "approved", approved_market_index: marketIndex, campaign_id: campaignId,
    approved_by: approvedBy, approved_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("id", id).eq("status", "draft").select("*").single();
  if (error) throw new Error(`approve_marketing_proposal_failed: ${error.message}`);
  return data as MarketingProposalRow;
}
