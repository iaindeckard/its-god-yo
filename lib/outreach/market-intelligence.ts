import "server-only";
import { getSupabaseAdmin } from "../supabaseAdmin";
import { createCampaign, deleteDraftCampaign, updateCampaign, type Campaign } from "./campaigns";
import type { MarketingAnalysis } from "./marketing-analysis";
import type { MarketingProposalRow } from "./marketing-analyst";

export interface VerifiedMarketSnapshot {
  verified_congregations: number;
  attendance_known: number;
  states: Record<string, { congregations: number; known_attendance: number; denominations: Record<string, number>; sizes: Record<string, number> }>;
  first_party_campaign_results: Array<{ name: string; region: string; contacted: number; redeemed: number; net_revenue_cents: number }>;
  limitations: string[];
}

export interface GeneratedMarketDraft { recommendation_index: number; campaign: Campaign; profile_id: string }

const directoryIdForDenomination = (name: string): string | null => {
  const value = name.toLowerCase();
  if (value.includes("catholic")) return "usccb";
  if (value.includes("episcopal")) return "episcopal";
  if (value.includes("united methodist")) return "umc";
  if (value.includes("elca")) return "elca";
  if (value.includes("presbyterian church (u.s.a.)")) return "pcusa";
  if (value.includes("southern baptist")) return "sbc";
  if (value.includes("missouri synod")) return "lcms";
  return null;
};

export async function getVerifiedMarketSnapshot(): Promise<VerifiedMarketSnapshot> {
  const admin = getSupabaseAdmin();
  const [{ data: leads, error: leadError }, { data: performance, error: performanceError }] = await Promise.all([
    admin.from("igy_outreach_leads").select("state,denomination_type,size_bucket,estimated_attendance")
      .in("verification_status", ["passed", "manual_override"]).limit(2000),
    admin.from("v_outreach_campaign_performance").select("name,region,contacted,redeemed,net_revenue_cents").limit(100),
  ]);
  if (leadError || performanceError) throw new Error(`market_snapshot_failed: ${leadError?.message ?? performanceError?.message}`);
  const states: VerifiedMarketSnapshot["states"] = {};
  let attendanceKnown = 0;
  for (const lead of leads ?? []) {
    const state = String(lead.state || "unknown").toUpperCase();
    const row = states[state] ?? { congregations: 0, known_attendance: 0, denominations: {}, sizes: {} };
    row.congregations++;
    if (Number(lead.estimated_attendance) > 0) { row.known_attendance++; attendanceKnown++; }
    const denomination = String(lead.denomination_type || "unknown");
    const size = String(lead.size_bucket || "unknown");
    row.denominations[denomination] = (row.denominations[denomination] ?? 0) + 1;
    row.sizes[size] = (row.sizes[size] ?? 0) + 1;
    states[state] = row;
  }
  return {
    verified_congregations: (leads ?? []).length,
    attendance_known: attendanceKnown,
    states,
    first_party_campaign_results: (performance ?? []).map((row) => ({
      name: String(row.name), region: String(row.region), contacted: Number(row.contacted ?? 0),
      redeemed: Number(row.redeemed ?? 0), net_revenue_cents: Number(row.net_revenue_cents ?? 0),
    })),
    limitations: [
      "Congregation attendee demographics are unknown unless a cited congregation or denomination publishes them.",
      "Area demographics describe residents, not the membership of a specific congregation.",
      "Unknown attendance is preserved as unknown and is never estimated from buildings, staff, or denomination.",
    ],
  };
}

export async function createMarketIntelligenceDrafts(args: {
  proposal: MarketingProposalRow; analysis: MarketingAnalysis; snapshot: VerifiedMarketSnapshot; createdBy: string | null;
}): Promise<GeneratedMarketDraft[]> {
  const admin = getSupabaseAdmin();
  const created: GeneratedMarketDraft[] = [];
  try {
    for (const [index, market] of args.analysis.recommendations.entries()) {
      const stateSnapshot = args.snapshot.states[market.state.toUpperCase()] ?? null;
      const locallyVerifiedDenominations = stateSnapshot
        ? Object.entries(stateSnapshot.denominations).sort((a, b) => b[1] - a[1]).map(([name]) => directoryIdForDenomination(name)).filter((value): value is string => Boolean(value)).slice(0, 3)
        : [];
      const firstPartySummary = args.snapshot.first_party_campaign_results.reduce((summary, row) => ({
        contacted: summary.contacted + row.contacted, redeemed: summary.redeemed + row.redeemed,
        net_revenue_cents: summary.net_revenue_cents + row.net_revenue_cents,
      }), { contacted: 0, redeemed: 0, net_revenue_cents: 0 });
      const investmentCap = args.proposal.budget_level === "growth" ? 25_000 : args.proposal.budget_level === "moderate" ? 10_000 : 2_500;
      const evidenceAdjustedCap = firstPartySummary.redeemed > 0 ? investmentCap : Math.min(investmentCap, 2_500);
      const strategy = {
        ...market.campaign_strategy,
        denomination_filters: market.campaign_strategy.denomination_filters.length
          ? market.campaign_strategy.denomination_filters
          : locallyVerifiedDenominations,
        investment_cents: Math.min(market.campaign_strategy.investment_cents, evidenceAdjustedCap),
      };
      const campaign = await createCampaign({
        name: `${market.market_name} | ${args.proposal.objective.replaceAll("_", " ")}`,
        centerLabel: market.center_label, radiusMiles: market.radius_miles,
        sizeFilter: strategy.size_filters.length ? strategy.size_filters : null,
        denominationFilter: strategy.denomination_filters.length ? strategy.denomination_filters : null,
        discoveryTargetCount: market.test_size,
        createdBy: args.createdBy,
      });
      await updateCampaign(campaign.id, {
        discount_percent: strategy.discount_percent,
        investment_cents: strategy.investment_cents,
      });
      const { data: profile, error } = await admin.from("outreach_market_intelligence_profiles").insert({
        proposal_id: args.proposal.id, recommendation_index: index, campaign_id: campaign.id,
        market_name: market.market_name, center_label: market.center_label,
        state_code: market.state || null, area_demographics: market.profile.area_demographics,
        congregation_landscape: { ...market.profile.congregation_landscape, igy_verified_state_snapshot: stateSnapshot },
        attendee_profile: market.profile.attendee_profile, economics: market.profile.economics,
        public_outreach: market.profile.public_outreach, campaign_strategy: strategy,
        evidence: market.evidence, data_limitations: [...args.analysis.data_limitations, ...market.profile.attendee_profile.limitations],
        verified_data_snapshot: { state: stateSnapshot, first_party_result_summary: firstPartySummary, limitations: args.snapshot.limitations }, created_by: args.createdBy,
      }).select("id").single();
      if (error) { await deleteDraftCampaign(campaign.id).catch(() => {}); throw new Error(`market_profile_create_failed: ${error.message}`); }
      created.push({ recommendation_index: index, campaign: await updateCampaign(campaign.id, {}), profile_id: profile.id });
    }
    const { error } = await admin.from("outreach_marketing_proposals").update({ auto_drafts_created_at: new Date().toISOString() }).eq("id", args.proposal.id).is("auto_drafts_created_at", null);
    if (error) throw new Error(`market_proposal_finalize_failed: ${error.message}`);
    return created;
  } catch (error) {
    await admin.from("outreach_market_intelligence_profiles").delete().eq("proposal_id", args.proposal.id);
    for (const row of created) await deleteDraftCampaign(row.campaign.id).catch(() => {});
    throw error;
  }
}

export async function getCampaignMarketProfile(campaignId: string) {
  const { data, error } = await getSupabaseAdmin().from("outreach_market_intelligence_profiles").select("*").eq("campaign_id", campaignId).maybeSingle();
  if (error) throw new Error(`market_profile_read_failed: ${error.message}`);
  return data;
}
