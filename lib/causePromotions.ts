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
  start_date: string;
  end_date: string;
  member_subscriptions: number;
  segment_gross_cents: number;
  segment_net_cents: number;
  payout_cents: number;
}

export interface CausePromotionMember {
  promotion_id: string;
  charity_name: string;
  pending_signup_id: string;
  stripe_subscription_id: string | null;
  purchaser_email: string | null;
  plan_key: string;
  sub_interval: "monthly" | "annual";
  promo_code: string | null;
  dm_addon: boolean;
  subscription_created_at: string | null;
  net_cents: number;
  gross_settled_cents: number;
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
