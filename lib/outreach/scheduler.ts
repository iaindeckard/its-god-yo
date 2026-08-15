import "server-only";
import { getSupabaseAdmin } from "../supabaseAdmin";
import { getCampaign, updateCampaign, type Campaign } from "./campaigns";
import { fetchActiveLeads } from "./leads";
import { isSendable } from "./verify";
import { runSend, type SendReport } from "./run";
import { hasAudienceBlocker, nextReleaseAt, validTimeZone } from "./schedule-policy";
const TABLE = "outreach_campaigns";

export interface ScheduleSnapshot extends Record<string, unknown> {
  lead_ids: string[];
  recipient_count: number;
  message_variant: string;
  discount_percent: number;
  size_filter: string[] | null;
  approved_at: string;
  approved_by: string | null;
}

/** Human approval boundary: capture the exact currently-active, verified audience. */
export async function scheduleCampaign(
  campaignId: string,
  input: { releaseAt: string; timezone: string; approvedBy: string | null; leadIds: string[] },
): Promise<Campaign> {
  const campaign = await getCampaign(campaignId);
  if (!campaign) throw new Error("campaign_not_found");
  const release = new Date(input.releaseAt);
  if (!Number.isFinite(release.getTime()) || release.getTime() <= Date.now()) throw new Error("release_must_be_in_future");
  if (!validTimeZone(input.timezone)) throw new Error("invalid_release_timezone");

  if (!input.leadIds.length) throw new Error("select_release_recipients");
  const leads = (await fetchActiveLeads({ campaignId, leadIds: input.leadIds })).filter(isSendable);
  if (!leads.length) throw new Error("no_verified_active_recipients");
  if (leads.length !== input.leadIds.length) throw new Error("release_recipient_selection_changed");
  const approvedAt = new Date().toISOString();
  const snapshot: ScheduleSnapshot = {
    lead_ids: leads.map((lead) => lead.id),
    recipient_count: leads.length,
    message_variant: campaign.message_variant ?? "default",
    discount_percent: campaign.discount_percent,
    size_filter: campaign.size_filter,
    approved_at: approvedAt,
    approved_by: input.approvedBy,
  };
  return updateCampaign(campaignId, {
    status: "scheduled",
    release_at: release.toISOString(),
    release_timezone: input.timezone,
    scheduled_at: approvedAt,
    scheduled_by: input.approvedBy,
    schedule_snapshot: snapshot,
    release_started_at: null,
    release_completed_at: null,
    last_release_report: null,
  });
}

export async function pauseCampaign(campaignId: string): Promise<Campaign> {
  const campaign = await getCampaign(campaignId);
  if (!campaign) throw new Error("campaign_not_found");
  if (campaign.status !== "scheduled") throw new Error("only_scheduled_campaigns_can_be_paused");
  return updateCampaign(campaignId, { status: "paused" });
}

export async function listDueCampaigns(now = new Date()): Promise<Campaign[]> {
  const admin = getSupabaseAdmin();
  // A function crash must not strand a campaign forever. Normal runs are capped
  // at five minutes, so a 15-minute sending claim is safely considered stale.
  const staleBefore = new Date(now.getTime() - 15 * 60_000).toISOString();
  await admin.from(TABLE).update({ status: "scheduled", updated_at: now.toISOString() })
    .eq("status", "sending").lte("release_started_at", staleBefore).lte("release_at", now.toISOString());
  const { data, error } = await admin
    .from(TABLE)
    .select("*")
    .eq("status", "scheduled")
    .lte("release_at", now.toISOString())
    .order("release_at", { ascending: true });
  if (error) throw new Error(`list_due_campaigns_failed: ${error.message}`);
  return (data ?? []) as Campaign[];
}

async function claimDueCampaign(campaign: Campaign): Promise<Campaign | null> {
  if (!campaign.release_at) return null;
  const { data, error } = await getSupabaseAdmin().from(TABLE).update({
    status: "sending", release_started_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("id", campaign.id).eq("status", "scheduled").eq("release_at", campaign.release_at).select("*").maybeSingle();
  if (error) throw new Error(`claim_due_campaign_failed: ${error.message}`);
  return (data as Campaign | null) ?? null;
}

/** Process only human-scheduled campaigns. Closed gates yield dry-runs and leave dates intact. */
export async function runScheduledCampaigns(now = new Date()): Promise<Array<{ campaign_id: string; report: SendReport }>> {
  const results: Array<{ campaign_id: string; report: SendReport }> = [];
  for (const due of await listDueCampaigns(now)) {
    const campaign = await claimDueCampaign(due);
    if (!campaign) continue;
    const snapshot = campaign.schedule_snapshot as ScheduleSnapshot | null;
    if (!snapshot?.lead_ids?.length) {
      await updateCampaign(campaign.id, { status: "paused" });
      continue;
    }
    const startedAt = new Date().toISOString();
    try {
      const report = await runSend({ campaignId: campaign.id, leadIds: snapshot.lead_ids, updateCampaignStatus: false });
      results.push({ campaign_id: campaign.id, report });
      if (report.mode !== "live") {
        await updateCampaign(campaign.id, { status: "scheduled", last_release_report: report as unknown as Record<string, unknown> });
        continue;
      }
      if (hasAudienceBlocker(report.items)) {
        // A mismatched allowlist or newly-stale verification means the approved
        // snapshot was not fully attempted. Pause instead of advancing cadence.
        await updateCampaign(campaign.id, { status: "paused", last_release_report: report as unknown as Record<string, unknown> });
        continue;
      }
      const hasFirstTouch = report.items.some((item) => item.outcome === "sent" && item.touch === 1);
      const hasSecondTouch = report.items.some((item) => item.outcome === "sent" && item.touch === 2);
      const errorsRemain = report.errors > 0;
      if (errorsRemain) {
        await updateCampaign(campaign.id, { status: "scheduled", last_release_report: report as unknown as Record<string, unknown> });
      } else if (hasFirstTouch && !hasSecondTouch) {
        await updateCampaign(campaign.id, {
          status: "scheduled",
          release_at: nextReleaseAt(campaign.release_at ?? startedAt),
          release_completed_at: startedAt,
          last_release_report: report as unknown as Record<string, unknown>,
        });
      } else {
        await updateCampaign(campaign.id, {
          status: "completed", release_completed_at: startedAt, last_release_report: report as unknown as Record<string, unknown>,
        });
      }
    } catch (error) {
      await updateCampaign(campaign.id, { status: "scheduled" }).catch(() => {});
      throw error;
    }
  }
  return results;
}
