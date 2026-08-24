import "server-only";
import { sendGate, sendAllowlist } from "./config";
import { fetchActiveLeads, recordSend, type OutreachLead, type SendScope } from "./leads";
import { buildEmail, buildFollowupEmail, sendViaResend, type BuiltEmail } from "./email";
import { updateCampaign, listCampaigns } from "./campaigns";
import { resolveVariant, clampDiscountPercent, VARIANT_PROFILE, TOUCH2_FLAT_PERCENT, type MessageVariant, type VariantProfile } from "./templates";
import { isSendable } from "./verify";
import { claimDelivery, markDeliveryFailed, markDeliverySent, type DeliveryClaim } from "./deliveries";

/**
 * Two-touch outreach sequence (Iain, 2026-08-05):
 *   send_count 0                        -> email 1 (code-free introduction)
 *   send_count 1 AND >= 30 days elapsed -> email 2 (follow-up + 10%-off code)
 *   send_count >= 2  (or 1 but < 30d)   -> nothing (complete, or not due yet)
 *
 * The 10%-off code is minted at the SECOND touch only. Cadence rides the existing
 * monthly send cron (~30-day spacing); we STOP after two touches, with no age-out
 * re-sends. A lead that unsubscribed / bounced / converted is already excluded by
 * fetchActiveLeads (status='active' only), so it never receives touch 2.
 */
const FOLLOWUP_DAYS = 30;

/** Per-lead resolved offer: the campaign's discount + message variant, or the
 *  default (10% / 'default') for legacy/global-cron leads with no campaign. */
interface Offer { discountPercent: number; variant: MessageVariant }
const DEFAULT_OFFER: Offer = { discountPercent: 10, variant: "default" };

/** Resolve the email to send (or preview) for a touch, plus the promo code shown
 *  in the report. No per-lead minting: every code is a shared, pre-created promo.
 *    touch 1 — default: code-free intro; schools: pitch carrying APPRECIATION10.
 *    touch 2 — default: shared TOUCH2-25 at a flat 25%; schools: code-free
 *              distribution ask (references APPRECIATION10 in its copy).
 *  The shared code is deliberately never stored per-lead (see VARIANT_PROFILE): the
 *  conversion webhook matches promo_promotion_code_id and would mass-convert on one
 *  redemption, so per-lead attribution rides the signed entry URL instead. */
export function renderTouch(lead: OutreachLead, offer: Offer, touch: 1 | 2): { email: BuiltEmail; code: string } {
  const profile = VARIANT_PROFILE[offer.variant];
  if (touch === 1) {
    const email = buildEmail(lead, offer.variant, offer.discountPercent);
    // A shared-code pitch (schools) carries its code up front; default is code-free.
    const code = offer.variant === "catholic_school" ? (profile.sharedPromoCode ?? "") : "";
    return { email, code };
  }
  if (offer.variant === "catholic_school") {
    // Distribution nudge: no new offer; the copy references the existing code.
    return { email: buildFollowupEmail(lead, "", offer.discountPercent, offer.variant), code: "" };
  }
  // Default church follow-up: the shared flat code (TOUCH2-25) at a fixed 25%,
  // regardless of the campaign's own Touch-1 discount tier.
  const code = profile.sharedPromoCode ?? "";
  return { email: buildFollowupEmail(lead, code, TOUCH2_FLAT_PERCENT, offer.variant), code };
}

/** Which touch (if any) is due for this active lead right now. A single-touch
 *  variant (e.g. catholic_school) sends exactly one email (the code is in it), so
 *  it is complete after send_count 1 and never gets a second touch. */
function dueTouch(lead: OutreachLead, profile: VariantProfile): 1 | 2 | null {
  if (lead.send_count === 0) return 1;
  if (profile.singleTouch) return null; // one email only; sequence complete after touch 1
  if (lead.send_count === 1) {
    const days = lead.last_sent_at
      ? (Date.now() - new Date(lead.last_sent_at).getTime()) / 86_400_000
      : Infinity;
    return days >= FOLLOWUP_DAYS ? 2 : null; // 2nd touch only after ~30 days
  }
  return null; // send_count >= 2: sequence complete (2-touch max)
}

/** send_count at which this variant's sequence is fully complete. */
function sequenceComplete(lead: OutreachLead, profile: VariantProfile): boolean {
  return lead.send_count >= (profile.singleTouch ? 1 : 2);
}

export interface SendItem {
  lead_id: string;
  org_name: string;
  to: string;
  outcome: "would_send" | "sent" | "not_due" | "sequence_complete" | "skipped_allowlist" | "skipped_unverified" | "already_claimed" | "error";
  touch: 1 | 2 | null;
  promo_code: string;
  subject: string;
  send_count_after: number;
  error?: string;
}

export interface SendReport {
  mode: "live" | "dry_run";
  gate_reasons: string[];
  scanned: number;
  sent: number;
  would_send: number;
  not_due: number;
  complete: number;
  skipped: number;
  skipped_unverified: number;
  errors: number;
  items: SendItem[];
  generated_at: string;
}

export interface RunSendOptions {
  /** Isolate the send to ONE campaign's active leads (per-campaign "send now"). */
  campaignId?: string;
  /** Narrow further to specific size buckets within the campaign. */
  sizeBuckets?: string[];
  /** Exact human-approved recipient snapshot for a scheduled release. */
  leadIds?: string[];
  /** Force dry-run even when the gate is open (safe preview). */
  forceDry?: boolean;
  /** Scheduler owns campaign lifecycle transitions around the full release. */
  updateCampaignStatus?: boolean;
}

/**
 * Run the outreach send. DRY-RUN unless the send gate is fully open (copy + legal
 * + master switch, see config.sendGate). In dry-run nothing is minted and nothing
 * is sent — it renders exactly who would receive which touch. Touch selection
 * (email 1 vs the 30-day email 2) is applied in BOTH modes.
 *
 * An optional scope isolates the send to a single campaign (+ size buckets) so a
 * promoted subset can be fired as its own deliberate push, separate from the
 * company-wide active-lead cycle. The scope controls WHO and WHEN only — the send
 * gate + allowlist still authoritatively govern WHETHER anything goes out live.
 */
export async function runSend(opts: RunSendOptions = {}): Promise<SendReport> {
  const { campaignId, sizeBuckets, leadIds, forceDry = false, updateCampaignStatus = true } = opts;
  const gate = sendGate();
  const live = gate.live && !forceDry;
  const allowlist = sendAllowlist();
  const scope: SendScope | undefined = campaignId ? { campaignId, sizeBuckets, leadIds } : undefined;
  const leads = await fetchActiveLeads(scope);

  // Per-campaign offer resolution (Phase 4a): map campaign_id -> {discount, variant}.
  // A lead with no campaign (legacy/global cron) uses DEFAULT_OFFER (10% / default).
  const offers = new Map<string, Offer>(
    (await listCampaigns()).map((c) => [c.id, { discountPercent: clampDiscountPercent(c.discount_percent), variant: resolveVariant(c.message_variant) }]),
  );
  const offerFor = (lead: OutreachLead): Offer => (lead.campaign_id ? offers.get(lead.campaign_id) ?? DEFAULT_OFFER : DEFAULT_OFFER);

  const report: SendReport = {
    mode: live ? "live" : "dry_run",
    gate_reasons: gate.reasons,
    scanned: leads.length,
    sent: 0, would_send: 0, not_due: 0, complete: 0, skipped: 0, skipped_unverified: 0, errors: 0,
    items: [],
    generated_at: new Date().toISOString(),
  };

  for (const lead of leads) {
    const offer = offerFor(lead);
    const profile = VARIANT_PROFILE[offer.variant];
    const touch = dueTouch(lead, profile);

    // Nothing due: either the sequence is fully sent (single- or two-touch max), or
    // email 1 went out but the 30-day window hasn't elapsed. Recorded so a dry run
    // explains every lead.
    if (touch === null) {
      const complete = sequenceComplete(lead, profile);
      if (complete) report.complete++; else report.not_due++;
      report.items.push({
        lead_id: lead.id, org_name: lead.org_name, to: lead.contact_email,
        outcome: complete ? "sequence_complete" : "not_due", touch: null,
        promo_code: "", subject: "", send_count_after: lead.send_count,
      });
      continue;
    }

    // Verification hard gate (BOTH modes): a lead must have PASSED verification —
    // or a permissioned manual override — and be within the freshness window
    // before it can be sent. Unverified / stale / needs_manual leads are skipped
    // and reported, so the dry-run preview matches exactly what a live send does.
    // There is no request parameter that bypasses this; only a verified lead sends.
    if (!isSendable(lead)) {
      report.skipped_unverified++;
      report.items.push({
        lead_id: lead.id, org_name: lead.org_name, to: lead.contact_email,
        outcome: "skipped_unverified", touch, promo_code: "", subject: "",
        send_count_after: lead.send_count,
      });
      continue;
    }

    // First controlled live batch may be restricted to an allowlist.
    if (live && allowlist && !allowlist.has(lead.contact_email.toLowerCase())) {
      report.skipped++;
      report.items.push({
        lead_id: lead.id, org_name: lead.org_name, to: lead.contact_email,
        outcome: "skipped_allowlist", touch, promo_code: "", subject: "",
        send_count_after: lead.send_count,
      });
      continue;
    }

    if (!live) {
      // Dry run: render, mint nothing, send nothing. renderTouch produces exactly
      // the email + code a live send would, so the preview is faithful.
      const { email: preview, code: previewCode } = renderTouch(lead, offer, touch);
      report.would_send++;
      report.items.push({
        lead_id: lead.id, org_name: lead.org_name, to: lead.contact_email,
        outcome: "would_send", touch, promo_code: previewCode,
        subject: preview.subject, send_count_after: lead.send_count + 1,
      });
      continue;
    }

    // Live send. No per-lead minting: renderTouch attaches the shared code (or none
    // for the schools distribution nudge). The shared code is NOT stored per-lead —
    // recordSend gets null so promo_promotion_code_id stays empty and the conversion
    // webhook can't mass-convert on a single redemption (attribution rides the URL).
    let claim: DeliveryClaim | null = null;
    try {
      if (campaignId) {
        claim = await claimDelivery(campaignId, lead.id, touch);
        if (!claim) {
          report.skipped++;
          report.items.push({
            lead_id: lead.id, org_name: lead.org_name, to: lead.contact_email,
            outcome: "already_claimed", touch, promo_code: "", subject: "",
            send_count_after: lead.send_count,
          });
          continue;
        }
      }
      const { email, code } = renderTouch(lead, offer, touch);
      const provider = await sendViaResend(email, claim?.idempotencyKey);
      await recordSend(lead.id, lead.send_count, null);
      if (claim) await markDeliverySent(claim, provider.id);
      report.sent++;
      report.items.push({
        lead_id: lead.id, org_name: lead.org_name, to: lead.contact_email,
        outcome: "sent", touch, promo_code: code,
        subject: email.subject,
        send_count_after: lead.send_count + 1,
      });
    } catch (e) {
      if (claim) await markDeliveryFailed(claim, e instanceof Error ? e.message : String(e));
      report.errors++;
      report.items.push({
        lead_id: lead.id, org_name: lead.org_name, to: lead.contact_email,
        outcome: "error", touch, promo_code: "", subject: "",
        send_count_after: lead.send_count, error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // A live per-campaign manual send marks the campaign active. Scheduled sends
  // are finalized by scheduler.ts after the complete report is available.
  if (campaignId && live && report.sent > 0 && updateCampaignStatus) {
    await updateCampaign(campaignId, { status: "active" }).catch(() => {});
  }

  return report;
}
