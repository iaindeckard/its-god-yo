import "server-only";
import { OUTREACH, sendGate, manualDeployGate, sendAllowlist } from "./config";
import { fetchActiveLeads, recordSend, type OutreachLead, type SendScope } from "./leads";
import { buildEmail, buildFollowupEmail, sendViaResend } from "./email";
import { createPromoCode } from "../promoCodes";
import { updateCampaign, listCampaigns } from "./campaigns";
import { resolveVariant, clampDiscountPercent, type MessageVariant } from "./templates";
import { isSendable } from "./verify";

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

function codeSlug(org: string): string {
  return org.toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 16) || "CHURCH";
}

/** Per-lead resolved offer: the campaign's discount + message variant, or the
 *  default (10% / 'default') for legacy/global-cron leads with no campaign. */
interface Offer { discountPercent: number; variant: MessageVariant }
const DEFAULT_OFFER: Offer = { discountPercent: 10, variant: "default" };

/** Mint (or reuse) this lead's one-time Stripe promo code at email 2, at the
 *  campaign's discount percent (default 10). Reuses lib/promoCodes so the coupon/
 *  PromotionCode plumbing matches the app. Note: a code minted earlier keeps its
 *  original percent (Stripe coupons are immutable) — only later leads pick up a
 *  changed campaign discount. */
async function ensurePromoCode(lead: OutreachLead, discountPercent: number): Promise<{ code: string; promotionCodeId: string }> {
  if (lead.promo_code && lead.promo_promotion_code_id) {
    return { code: lead.promo_code, promotionCodeId: lead.promo_promotion_code_id };
  }
  const code = `${OUTREACH.promoPrefix}-${codeSlug(lead.org_name)}-${lead.id.slice(0, 6).toUpperCase()}`;
  const view = await createPromoCode({
    code,
    discountType: "percent",
    value: clampDiscountPercent(discountPercent),
    duration: "once",
    maxRedemptions: 1,
    internalLabel: `outreach:${lead.id}`,
    note: `Church outreach - ${lead.org_name}`,
  });
  return { code: view.code, promotionCodeId: view.id };
}

/** Which touch (if any) is due for this active lead right now. */
function dueTouch(lead: OutreachLead): 1 | 2 | null {
  if (lead.send_count === 0) return 1;
  if (lead.send_count === 1) {
    const days = lead.last_sent_at
      ? (Date.now() - new Date(lead.last_sent_at).getTime()) / 86_400_000
      : Infinity;
    return days >= FOLLOWUP_DAYS ? 2 : null; // 2nd touch only after ~30 days
  }
  return null; // send_count >= 2: sequence complete (2-touch max)
}

export interface SendItem {
  lead_id: string;
  org_name: string;
  to: string;
  outcome: "would_send" | "sent" | "not_due" | "sequence_complete" | "skipped_allowlist" | "skipped_unverified" | "error";
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
  /** Force dry-run even when the gate is open (safe preview). */
  forceDry?: boolean;
  /** Authenticated admin explicitly confirmed the one-time Deploy prompt. */
  manualDeploy?: boolean;
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
  const { campaignId, sizeBuckets, forceDry = false, manualDeploy = false } = opts;
  const gate = manualDeploy ? manualDeployGate() : sendGate();
  const live = gate.live && !forceDry;
  const allowlist = sendAllowlist();
  const scope: SendScope | undefined = campaignId ? { campaignId, sizeBuckets } : undefined;
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
    const touch = dueTouch(lead);

    // Nothing due: either both touches already sent (2-touch max), or email 1 went
    // out but the 30-day window hasn't elapsed. Recorded so a dry run explains
    // every lead.
    if (touch === null) {
      const complete = lead.send_count >= 2;
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

    const offer = offerFor(lead);

    if (!live) {
      // Dry run: render, mint nothing, send nothing. Email 2 shows the code that
      // WOULD be minted/reused so the preview is faithful — with the campaign's
      // discount + variant applied exactly as a live send would.
      const previewCode = touch === 2
        ? (lead.promo_code ?? `${OUTREACH.promoPrefix}-${codeSlug(lead.org_name)}-${lead.id.slice(0, 6).toUpperCase()}`)
        : "";
      const preview = touch === 2
        ? buildFollowupEmail(lead, previewCode, offer.discountPercent, offer.variant)
        : buildEmail(lead, offer.variant);
      report.would_send++;
      report.items.push({
        lead_id: lead.id, org_name: lead.org_name, to: lead.contact_email,
        outcome: "would_send", touch, promo_code: previewCode,
        subject: preview.subject, send_count_after: lead.send_count + 1,
      });
      continue;
    }

    // Live send. Touch 1 is code-free; touch 2 mints/attaches the code at the
    // campaign's discount, with the campaign's message variant.
    try {
      let promo: { code: string; promotionCodeId: string } | null = null;
      let email;
      if (touch === 1) {
        email = buildEmail(lead, offer.variant);
      } else {
        promo = await ensurePromoCode(lead, offer.discountPercent);
        email = buildFollowupEmail(lead, promo.code, offer.discountPercent, offer.variant);
      }
      await sendViaResend(email);
      await recordSend(lead.id, lead.send_count, promo);
      report.sent++;
      report.items.push({
        lead_id: lead.id, org_name: lead.org_name, to: lead.contact_email,
        outcome: "sent", touch, promo_code: promo?.code ?? "", subject: email.subject,
        send_count_after: lead.send_count + 1,
      });
    } catch (e) {
      report.errors++;
      report.items.push({
        lead_id: lead.id, org_name: lead.org_name, to: lead.contact_email,
        outcome: "error", touch, promo_code: "", subject: "",
        send_count_after: lead.send_count, error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // A live per-campaign send that actually mailed marks the campaign 'sending'.
  if (campaignId && live && report.sent > 0) {
    await updateCampaign(campaignId, { status: "sending" }).catch(() => {});
  }

  return report;
}
