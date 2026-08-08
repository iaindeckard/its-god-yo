import "server-only";
import { getSupabaseAdmin } from "./supabaseAdmin";

/**
 * Reusable cause-promotion tracking (LOCKED spec 2026-08-06). Read surface over the
 * generic segment-computation views (migration 20260806140000_cause_promotions):
 *   - v_cause_promotion_members : one row per (promotion, qualifying subscription)
 *   - v_cause_promotion_totals  : per-promotion rollup incl. the pledged payout
 *
 * A subscription is a member of a promotion when it matches EVERY set condition on
 * the promotion row (qualifying_promo_codes, optional require_plan_type interval,
 * optional require_dm_addon) AND was purchased within [start_date, end_date]. Net
 * proceeds use the canonical settled_net_cents (Stripe bt.net; charge +, refund /
 * dispute -), so the sum already excludes Stripe fees and nets out refunds AND
 * chargebacks — the same net the reconcile ledger records, NOT the donation-fund
 * daily-close net (which deliberately does not net refunds). This is intentionally
 * separate from igy_donation_fund_ledger (company-wide tithe on overall profit).
 *
 * This module is tracking/computation only. The December payout writes to the
 * existing igy_donation_disbursements table; disbursementRow() below builds that
 * payload but nothing here writes it — the payout is a deliberate separate step.
 */

export interface CausePromotionTotal {
  promotion_id: string;
  charity_name: string;
  payout_rate: number;
  status: "active" | "closed" | "paid";
  start_at: string;
  end_at: string;
  customer_facing_enabled: boolean;
  // Derived lifecycle phase (now vs start_at/end_at); no manual turn-off step.
  phase: "scheduled" | "active" | "closed";
  member_subscriptions: number;
  realized_members: number;
  trial_members: number;
  realized_gross_cents: number;
  // REALIZED: actual settled money (subscription_payments). REALIZED keeps accruing
  // after end_at for already-tagged subs.
  realized_net_cents: number;
  // POTENTIAL: expected value of in-trial members (not charged, not cancelled);
  // expires to 0 at end_at. Tracked/displayed SEPARATELY, never blended with realized.
  potential_cents: number;
  // Pledged payout — computed on REALIZED net ONLY, never potential.
  payout_cents: number;
}

export interface CausePromotionMember {
  promotion_id: string;
  charity_name: string;
  pending_signup_id: string;
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
  purchaser_email: string | null;
  plan_key: string;
  sub_interval: "monthly" | "annual";
  promo_code: string | null;
  dm_addon: boolean;
  signup_status: string | null;
  subscription_created_at: string | null;
  realized_net_cents: number;
  realized_gross_cents: number;
  is_realized: boolean;
  is_trial: boolean;
  potential_cents: number;
}

/** One customer's own contribution to a customer-facing promotion (for /cause/status). */
export interface CustomerCauseContribution {
  promotion_id: string;
  charity_name: string;
  public_title: string | null;
  public_blurb: string | null;
  phase: "scheduled" | "active" | "closed";
  my_realized_cents: number;   // "contributed so far" — real settled money
  my_potential_cents: number;  // "pending, if your trial converts"
}

/** Per-promotion rollups. Pass a promotionId to scope to one (the parameterized
 *  "by promotion_id" read); omit for all promotions. */
export async function getCausePromotionTotals(promotionId?: string): Promise<CausePromotionTotal[]> {
  let q = getSupabaseAdmin().from("v_cause_promotion_totals").select("*");
  if (promotionId) q = q.eq("promotion_id", promotionId);
  const { data, error } = await q.order("charity_name");
  if (error) throw new Error(`cause_promotion_totals_failed: ${error.message}`);
  return (data ?? []) as CausePromotionTotal[];
}

/**
 * One customer's own contribution to every CUSTOMER-FACING promotion, for the
 * tokenized /cause/status page. Scoped strictly to the passed stripe customer id —
 * a customer only ever sees their own subscriptions' realized + potential. Returns
 * only promotions with customer_facing_enabled = true (the per-promotion gate; the
 * global CAUSE_PUBLIC_ENABLED flag is enforced at the page).
 */
export async function getCustomerCauseContribution(customerId: string): Promise<CustomerCauseContribution[]> {
  const admin = getSupabaseAdmin();

  // The customer-facing promotions and their public copy / phase.
  const { data: totals, error: tErr } = await admin
    .from("v_cause_promotion_totals")
    .select("promotion_id, charity_name, public_title, public_blurb, phase, customer_facing_enabled")
    .eq("customer_facing_enabled", true);
  if (tErr) throw new Error(`cause_customer_totals_failed: ${tErr.message}`);
  if (!totals?.length) return [];

  // This customer's own member rows across those promotions.
  const promoIds = totals.map((t) => t.promotion_id);
  const { data: mine, error: mErr } = await admin
    .from("v_cause_promotion_members")
    .select("promotion_id, realized_net_cents, potential_cents")
    .eq("stripe_customer_id", customerId)
    .in("promotion_id", promoIds);
  if (mErr) throw new Error(`cause_customer_members_failed: ${mErr.message}`);

  return totals.map((t) => {
    const rows = (mine ?? []).filter((r) => r.promotion_id === t.promotion_id);
    return {
      promotion_id: t.promotion_id,
      charity_name: t.charity_name,
      public_title: t.public_title ?? null,
      public_blurb: t.public_blurb ?? null,
      phase: t.phase,
      my_realized_cents: rows.reduce((s, r) => s + (r.realized_net_cents ?? 0), 0),
      my_potential_cents: rows.reduce((s, r) => s + (r.potential_cents ?? 0), 0),
    };
  });
}

/** The qualifying subscriptions behind a promotion's total (for spot-checking). */
export async function getCausePromotionMembers(promotionId: string): Promise<CausePromotionMember[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("v_cause_promotion_members")
    .select("*")
    .eq("promotion_id", promotionId)
    .order("subscription_created_at");
  if (error) throw new Error(`cause_promotion_members_failed: ${error.message}`);
  return (data ?? []) as CausePromotionMember[];
}

/**
 * Build the igy_donation_disbursements payload for a promotion's payout. Pure — it
 * does NOT insert. The caller (the eventual December payout step) supplies
 * business_unit_id (NOT NULL on the table; resolve the IGY business unit the same
 * way the donation-fund path does) and disbursed_on, then inserts. amount_cents is
 * the already-computed payout_cents (segment_net_cents x payout_rate) from the view,
 * so the net definition is not re-derived at payout time.
 */
export function disbursementRow(total: CausePromotionTotal): {
  charity_name: string;
  amount_cents: number;
  triggered_by: string;
} {
  return {
    charity_name: total.charity_name,
    amount_cents: total.payout_cents,
    triggered_by: `cause_promotion:${total.promotion_id}`,
  };
}
