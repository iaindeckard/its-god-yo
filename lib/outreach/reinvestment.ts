import "server-only";
import { getSupabaseAdmin } from "../supabaseAdmin";
import { calculateReinvestment, type ReinvestmentPolicy, type RoiCandidate } from "./reinvestment-core";

const POLICY = "outreach_reinvestment_policy";
const PROPOSALS = "outreach_reinvestment_proposals";
const ALLOCATIONS = "outreach_reinvestment_allocations";

export interface ReinvestmentProposal {
  id: string;
  period_start: string;
  period_end: string;
  status: "proposed" | "approved" | "executing" | "executed" | "rejected";
  policy_snapshot: ReinvestmentPolicy;
  evidence_snapshot: RoiCandidate[];
  realized_net_revenue_cents: number;
  proposed_reinvestment_cents: number;
  created_at: string;
  approved_at: string | null;
  executed_at: string | null;
  execution_error: string | null;
  outreach_reinvestment_allocations?: Array<{
    id: string; source_campaign_id: string; source_campaign_name: string;
    invested_cents: number; net_revenue_cents: number; newly_realized_net_cents: number; profit_cents: number;
    roi_bps: number; contacted: number; conversions: number; allocated_cents: number;
    created_campaign_id: string | null;
  }>;
}

function period(now = new Date()): { start: string; end: string } {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - mondayOffset);
  const start = date.toISOString().slice(0, 10);
  const endDate = new Date(date); endDate.setUTCDate(endDate.getUTCDate() + 6);
  return { start, end: endDate.toISOString().slice(0, 10) };
}

export async function getReinvestmentPolicy(): Promise<ReinvestmentPolicy> {
  const { data, error } = await getSupabaseAdmin().from(POLICY).select("*").eq("id", true).single();
  if (error) throw new Error(`reinvestment_policy_failed: ${error.message}`);
  return data as ReinvestmentPolicy;
}

export async function updateReinvestmentPolicy(patch: Partial<ReinvestmentPolicy>, userId: string | null) {
  const allowed = ["enabled","reinvest_rate_bps","minimum_contacted","minimum_conversions","minimum_roi_bps","maximum_cycle_cents","maximum_campaign_share_bps"] as const;
  const clean: Record<string, unknown> = {};
  for (const key of allowed) if (patch[key] != null) clean[key] = patch[key];
  const { data, error } = await getSupabaseAdmin().from(POLICY)
    .update({ ...clean, updated_by: userId, updated_at: new Date().toISOString() }).eq("id", true).select("*").single();
  if (error) throw new Error(`reinvestment_policy_update_failed: ${error.message}`);
  return data as ReinvestmentPolicy;
}

export async function listReinvestmentProposals(): Promise<ReinvestmentProposal[]> {
  const { data, error } = await getSupabaseAdmin().from(PROPOSALS)
    .select("*, outreach_reinvestment_allocations(*)").order("created_at", { ascending: false }).limit(20);
  if (error) throw new Error(`reinvestment_proposals_failed: ${error.message}`);
  return (data ?? []) as ReinvestmentProposal[];
}

export async function generateReinvestmentProposal(createdBy: string | null = null): Promise<ReinvestmentProposal | null> {
  const admin = getSupabaseAdmin();
  const policy = await getReinvestmentPolicy();
  if (!policy.enabled) return null;
  const dates = period();
  const { data: existing } = await admin.from(PROPOSALS).select("id").eq("period_start", dates.start).eq("period_end", dates.end).maybeSingle();
  if (existing) return (await listReinvestmentProposals()).find((proposal) => proposal.id === existing.id) ?? null;
  const [{ data: campaigns, error: campaignError }, { data: performance, error: performanceError }] = await Promise.all([
    admin.from("outreach_campaigns").select("id,name,investment_cents,reinvested_net_revenue_cents"),
    admin.from("v_outreach_campaign_performance").select("campaign_id,contacted,redeemed,net_revenue_cents"),
  ]);
  if (campaignError || performanceError) throw new Error(`reinvestment_evidence_failed: ${campaignError?.message ?? performanceError?.message}`);
  const byCampaign = new Map((performance ?? []).map((row) => [row.campaign_id, row]));
  const candidates: RoiCandidate[] = (campaigns ?? []).map((campaign) => {
    const metrics = byCampaign.get(campaign.id);
    return { campaign_id: campaign.id, name: campaign.name, invested_cents: Number(campaign.investment_cents ?? 0),
      reinvested_net_revenue_cents: Number(campaign.reinvested_net_revenue_cents ?? 0),
      net_revenue_cents: Number(metrics?.net_revenue_cents ?? 0), contacted: Number(metrics?.contacted ?? 0),
      conversions: Number(metrics?.redeemed ?? 0) };
  });
  const result = calculateReinvestment(policy, candidates);
  if (!result.allocations.length || result.pool_cents <= 0) return null;
  const { data: proposal, error } = await admin.from(PROPOSALS).insert({
    period_start: dates.start, period_end: dates.end, policy_snapshot: policy,
    evidence_snapshot: candidates, realized_net_revenue_cents: result.realized_net_revenue_cents,
    proposed_reinvestment_cents: result.pool_cents, created_by: createdBy,
  }).select("*").single();
  if (error) {
    if (error.code === "23505") return (await listReinvestmentProposals())[0] ?? null;
    throw new Error(`reinvestment_proposal_create_failed: ${error.message}`);
  }
  const { error: allocationError } = await admin.from(ALLOCATIONS).insert(result.allocations.map((row) => ({
    proposal_id: proposal.id, source_campaign_id: row.campaign_id, source_campaign_name: row.name,
    invested_cents: row.invested_cents, net_revenue_cents: row.net_revenue_cents,
    newly_realized_net_cents: row.newly_realized_net_cents,
    profit_cents: row.profit_cents, roi_bps: row.roi_bps, contacted: row.contacted,
    conversions: row.conversions, allocated_cents: row.allocated_cents,
  })));
  if (allocationError) throw new Error(`reinvestment_allocations_create_failed: ${allocationError.message}`);
  return (await listReinvestmentProposals()).find((row) => row.id === proposal.id) ?? null;
}

export async function approveAndExecuteReinvestment(id: string, userId: string): Promise<ReinvestmentProposal> {
  const admin = getSupabaseAdmin();
  const now = new Date().toISOString();
  const { data: claimed, error: claimError } = await admin.from(PROPOSALS)
    .update({ status: "executing", approved_by: userId, approved_at: now, execution_error: null })
    .eq("id", id).in("status", ["proposed", "approved"]).select("*").maybeSingle();
  if (claimError) throw new Error(`reinvestment_approval_failed: ${claimError.message}`);
  if (!claimed) throw new Error("reinvestment_proposal_not_approvable");
  try {
    const { data: allocations, error } = await admin.from(ALLOCATIONS).select("*").eq("proposal_id", id);
    if (error) throw error;
    for (const allocation of allocations ?? []) {
      const { data: source, error: sourceError } = await admin.from("outreach_campaigns").select("*").eq("id", allocation.source_campaign_id).single();
      if (sourceError) throw sourceError;
      let draftId = allocation.created_campaign_id as string | null;
      if (!draftId) {
        const { data: existingDraft } = await admin.from("outreach_campaigns").select("id")
          .eq("reinvestment_proposal_id", id).eq("reinvestment_source_campaign_id", source.id).maybeSingle();
        draftId = existingDraft?.id ?? null;
      }
      if (!draftId) {
        const { data: draft, error: draftError } = await admin.from("outreach_campaigns").insert({
          name: `Reinvest · ${source.name} · ${claimed.period_start}`,
          center_label: source.center_label, center_lat: source.center_lat, center_lng: source.center_lng,
          radius_miles: source.radius_miles, geography_type: source.geography_type, state_code: source.state_code,
          size_filter: source.size_filter, denomination_filter: source.denomination_filter,
          discount_percent: source.discount_percent, message_variant: source.message_variant,
          allocated_budget_cents: allocation.allocated_cents, investment_cents: 0,
          reinvestment_source_campaign_id: source.id, reinvestment_proposal_id: id,
          status: "draft", created_by: userId,
        }).select("id").single();
        if (draftError) throw draftError;
        draftId = draft.id;
      }
      if (!allocation.created_campaign_id) {
        const { error: linkError } = await admin.from(ALLOCATIONS).update({ created_campaign_id: draftId }).eq("id", allocation.id).is("created_campaign_id", null);
        if (linkError) throw linkError;
      }
      const { error: watermarkError } = await admin.from("outreach_campaigns")
        .update({ reinvested_net_revenue_cents: allocation.net_revenue_cents, updated_at: new Date().toISOString() })
        .eq("id", source.id).lte("reinvested_net_revenue_cents", allocation.net_revenue_cents);
      if (watermarkError) throw watermarkError;
    }
    const { error: finishError } = await admin.from(PROPOSALS).update({ status: "executed", executed_at: new Date().toISOString() }).eq("id", id).eq("status", "executing");
    if (finishError) throw finishError;
  } catch (error) {
    await admin.from(PROPOSALS).update({ status: "approved", execution_error: (error instanceof Error ? error.message : String(error)).slice(0, 500) }).eq("id", id);
    throw new Error(`reinvestment_execution_failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return (await listReinvestmentProposals()).find((row) => row.id === id) as ReinvestmentProposal;
}

export async function rejectReinvestment(id: string, userId: string): Promise<void> {
  const { data, error } = await getSupabaseAdmin().from(PROPOSALS)
    .update({ status: "rejected", rejected_by: userId, rejected_at: new Date().toISOString() })
    .eq("id", id).eq("status", "proposed").select("id").maybeSingle();
  if (error) throw new Error(`reinvestment_reject_failed: ${error.message}`);
  if (!data) throw new Error("reinvestment_proposal_not_rejectable");
}
