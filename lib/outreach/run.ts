import "server-only";
import { OUTREACH, sendGate, sendAllowlist } from "./config";
import { fetchActiveLeads, recordSend, type OutreachLead } from "./leads";
import { buildEmail, buildFollowupEmail, sendViaResend } from "./email";
import { createPromoCode } from "../promoCodes";

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

/** Mint (or reuse) this lead's one-time 10%-off Stripe promo code, at email 2.
 *  Reuses lib/promoCodes so the coupon/PromotionCode plumbing matches the app. */
async function ensurePromoCode(lead: OutreachLead): Promise<{ code: string; promotionCodeId: string }> {
  if (lead.promo_code && lead.promo_promotion_code_id) {
    return { code: lead.promo_code, promotionCodeId: lead.promo_promotion_code_id };
  }
  const code = `${OUTREACH.promoPrefix}-${codeSlug(lead.org_name)}-${lead.id.slice(0, 6).toUpperCase()}`;
  const view = await createPromoCode({
    code,
    discountType: "percent",
    value: 10,
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
  outcome: "would_send" | "sent" | "not_due" | "sequence_complete" | "skipped_allowlist" | "error";
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
  errors: number;
  items: SendItem[];
  generated_at: string;
}

/**
 * Run the outreach send. DRY-RUN unless the send gate is fully open (copy + legal
 * + master switch, see config.sendGate). In dry-run nothing is minted and nothing
 * is sent — it renders exactly who would receive which touch. Touch selection
 * (email 1 vs the 30-day email 2) is applied in BOTH modes.
 */
export async function runSend(forceDry = false): Promise<SendReport> {
  const gate = sendGate();
  const live = gate.live && !forceDry;
  const allowlist = sendAllowlist();
  const leads = await fetchActiveLeads();

  const report: SendReport = {
    mode: live ? "live" : "dry_run",
    gate_reasons: gate.reasons,
    scanned: leads.length,
    sent: 0, would_send: 0, not_due: 0, complete: 0, skipped: 0, errors: 0,
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
      // Dry run: render, mint nothing, send nothing. Email 2 shows the code that
      // WOULD be minted/reused so the preview is faithful.
      const previewCode = touch === 2
        ? (lead.promo_code ?? `${OUTREACH.promoPrefix}-${codeSlug(lead.org_name)}-${lead.id.slice(0, 6).toUpperCase()}`)
        : "";
      const preview = touch === 2 ? buildFollowupEmail(lead, previewCode) : buildEmail(lead);
      report.would_send++;
      report.items.push({
        lead_id: lead.id, org_name: lead.org_name, to: lead.contact_email,
        outcome: "would_send", touch, promo_code: previewCode,
        subject: preview.subject, send_count_after: lead.send_count + 1,
      });
      continue;
    }

    // Live send. Touch 1 is code-free; touch 2 mints/attaches the 10%-off code.
    try {
      let promo: { code: string; promotionCodeId: string } | null = null;
      let email;
      if (touch === 1) {
        email = buildEmail(lead);
      } else {
        promo = await ensurePromoCode(lead);
        email = buildFollowupEmail(lead, promo.code);
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

  return report;
}
