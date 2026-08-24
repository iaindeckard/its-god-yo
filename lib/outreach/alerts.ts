import "server-only";
import { getSupabaseAdmin } from "../supabaseAdmin";
import { claimAlert } from "../alertState";
import { sendOpsAlert } from "../opsAlert";
import { getCampaign } from "./campaigns";
import { campaignBounceStats } from "./deliveries";
import type { SendReport } from "./run";

/**
 * Outreach ops alerts (Touch-2 redesign, 2026-08-24). Both reuse the shared
 * sendOpsAlert channel (Resend -> account owner) and the claim_alert dedup RPC
 * so they fire at most once per campaign. Both are best-effort: an alert failure
 * must never break the webhook 200 or stall the send cadence.
 */

/** Fire when a campaign's bounced rate crosses this (fraction, 0..1). 15% is the
 *  low end of the spec's 15-20% band — flag early, before a bad list burns through
 *  hundreds of sends. Env-overridable. */
export const BOUNCE_ALERT_THRESHOLD = Number(process.env.OUTREACH_BOUNCE_ALERT_THRESHOLD || 0.15);
/** Don't evaluate the rate until at least this many messages were dispatched, so a
 *  tiny early sample (e.g. 1 of 3) can't trip the alarm. Env-overridable. */
export const BOUNCE_ALERT_MIN_SAMPLE = Number(process.env.OUTREACH_BOUNCE_ALERT_MIN_SAMPLE || 20);

/** Pure decision, separated from I/O so it's unit-testable: fire iff the sample is
 *  large enough AND the bounced rate is at or above the threshold. */
export function shouldFireBounceAlert(
  stats: { sent: number; bounced: number },
  opts: { threshold?: number; minSample?: number } = {},
): boolean {
  const threshold = opts.threshold ?? BOUNCE_ALERT_THRESHOLD;
  const minSample = opts.minSample ?? BOUNCE_ALERT_MIN_SAMPLE;
  if (stats.sent < minSample) return false;
  return stats.bounced / stats.sent >= threshold;
}

/** Evaluate one campaign's bounce rate and, if it crosses the threshold, fire a
 *  one-per-campaign ops alert. Called from the Resend webhook on each bounce.
 *  Never throws. */
export async function evaluateBounceRateAlert(campaignId: string): Promise<void> {
  try {
    const stats = await campaignBounceStats(campaignId);
    if (!shouldFireBounceAlert(stats)) return;
    const fire = await claimAlert(getSupabaseAdmin(), {
      alertType: "outreach_bounce_rate",
      entityKey: campaignId,
      cooldownMs: null, // once per campaign; no repeats as more bounces land
    });
    if (!fire) return;
    const campaign = await getCampaign(campaignId);
    const name = campaign?.name ?? campaignId;
    const rate = Math.round((stats.bounced / stats.sent) * 100);
    const threshold = Math.round(BOUNCE_ALERT_THRESHOLD * 100);
    await sendOpsAlert({
      subject: `IGY outreach: high bounce rate on "${name}" — ${rate}%`,
      text: [
        "The hard-bounce rate on this campaign crossed the alert threshold.",
        "",
        `Campaign:   ${name} (${campaignId})`,
        `Bounces:    ${stats.bounced} hard bounces out of ${stats.sent} sent = ${rate}%`,
        `Threshold:  ${threshold}% (min sample ${BOUNCE_ALERT_MIN_SAMPLE} sent)`,
        "",
        "A high hard-bounce rate usually means a stale or low-quality lead list.",
        "Recommend pausing this campaign and reviewing the list before it burns",
        "through more addresses.",
        "",
        "To halt: pause the campaign in /admin/outreach, or flip OUTREACH_SEND_LIVE",
        "off to stop all outreach sends.",
        "",
        "This alert fires once per campaign — you won't get repeats as more bounces",
        "land on the same list.",
      ].join("\n"),
    });
  } catch (e) {
    console.error("[outreach-bounce-alert] evaluation failed (continuing):", e instanceof Error ? e.message : e);
  }
}

/** Confirm to the owner that a campaign's Touch-2 follow-up actually fired. Called
 *  from the scheduler after a live run sends any second touch. One per campaign
 *  wave (claim_alert dedup). Never throws. */
export async function notifyTouch2Sent(
  campaign: { id: string; name: string },
  report: Pick<SendReport, "skipped" | "errors" | "items" | "generated_at">,
): Promise<void> {
  try {
    const fire = await claimAlert(getSupabaseAdmin(), {
      alertType: "outreach_touch2_sent",
      entityKey: campaign.id,
      cooldownMs: null, // one confirmation per campaign wave
    });
    if (!fire) return;
    const sentTouch2 = report.items.filter((i) => i.outcome === "sent" && i.touch === 2).length;
    await sendOpsAlert({
      subject: `IGY outreach: Touch-2 follow-up sent for "${campaign.name}" (${sentTouch2} orgs)`,
      text: [
        "The 30-day follow-up (Touch-2) just went out for this campaign.",
        "",
        `Campaign:  ${campaign.name} (${campaign.id})`,
        `Sent:      ${sentTouch2}    Skipped: ${report.skipped}    Errors: ${report.errors}`,
        `Fired at:  ${report.generated_at} (actual send time)`,
        "",
        "No action needed — this is a confirmation that the wave fired, so you don't",
        "have to check manually. If this list bounces above the threshold, a separate",
        "bounce-rate alert will follow.",
      ].join("\n"),
    });
  } catch (e) {
    console.error("[outreach-touch2-alert] confirmation failed (continuing):", e instanceof Error ? e.message : e);
  }
}
