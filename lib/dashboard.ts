import "server-only";
import { getSupabaseAdmin } from "./supabaseAdmin";
import { getStripe } from "./stripe";
import { PLANS, GROUP_BANDS, DM_ADDON } from "./plans";
import { getFundSummary } from "./donationFund";

/**
 * KPI dashboard data — all pulled from the REAL tables + live Stripe, never
 * mocked. Most figures are legitimately zero/near-zero right now (delayed
 * billing means no active subscriptions yet, and consent/pending tables are
 * empty), which is itself the accurate current picture.
 */
export interface DashboardData {
  activeSubscribers: { total: number; byTier: { label: string; count: number }[] };
  mrrCents: number;
  arrCents: number;
  pendingAwaitingConfirmation: number;
  reviewBacklog: { en: number; es: number };
  referralRedemptions: number;
  promoUsage: { code: string; times_redeemed: number; active: boolean }[];
  consentFunnel: { status: string; count: number }[];
  stripeError: string | null;
  // Reserved donation fund (financial — render only behind analytics.revenue.view).
  donationFund: { availableCents: number; accruedCents: number; disbursedCents: number; lastCloseDate: string | null } | null;
}

const CONSENT_STATUSES = ["pending_confirmation", "confirmed", "opted_out", "expired"];

function priceLabelMap(): Record<string, string> {
  const m: Record<string, string> = {};
  if (PLANS.individual_monthly.price_id) m[PLANS.individual_monthly.price_id] = "Individual (monthly)";
  if (PLANS.individual_annual.price_id) m[PLANS.individual_annual.price_id] = "Individual (annual)";
  if (PLANS.family_annual.price_id) m[PLANS.family_annual.price_id] = "Family";
  if (PLANS.gift_annual.price_id) m[PLANS.gift_annual.price_id] = "Gift";
  for (const b of GROUP_BANDS) m[b.price_id] = `Group ${b.min}–${b.max}`;
  m[DM_ADDON.price_id] = "DM from Him™ add-on";
  return m;
}

export async function getDashboardData(): Promise<DashboardData> {
  const admin = getSupabaseAdmin();

  const countEq = async (table: string, col: string, val: unknown): Promise<number> => {
    const { count } = await admin.from(table).select("*", { count: "exact", head: true }).eq(col, val);
    return count ?? 0;
  };

  const [
    pendingAwaitingConfirmation,
    referralRedemptions,
    reviewEn,
    reviewEs,
    consentCounts,
    stripe,
  ] = await Promise.all([
    countEq("pending_signups", "status", "awaiting_confirmation"),
    countEq("pending_signups", "referral_discount_applied", true),
    countEq("daily_slots", "status", "needs_review"),
    countEq("daily_slots", "status_es", "needs_review"),
    Promise.all(
      CONSENT_STATUSES.map(async (status) => ({ status, count: await countEq("consent_log", "consent_status", status) })),
    ),
    gatherStripe(),
  ]);

  // Donation fund is best-effort — a query failure must not blank the dashboard.
  let donationFund: DashboardData["donationFund"] = null;
  try {
    const f = await getFundSummary();
    donationFund = {
      availableCents: f.availableCents,
      accruedCents: f.accruedCents,
      disbursedCents: f.disbursedCents,
      lastCloseDate: f.lastCloseDate,
    };
  } catch {
    donationFund = null;
  }

  return {
    activeSubscribers: stripe.activeSubscribers,
    mrrCents: stripe.mrrCents,
    arrCents: stripe.mrrCents * 12,
    pendingAwaitingConfirmation,
    reviewBacklog: { en: reviewEn, es: reviewEs },
    referralRedemptions,
    promoUsage: stripe.promoUsage,
    consentFunnel: consentCounts,
    stripeError: stripe.error,
    donationFund,
  };
}

async function gatherStripe(): Promise<{
  activeSubscribers: { total: number; byTier: { label: string; count: number }[] };
  mrrCents: number;
  promoUsage: { code: string; times_redeemed: number; active: boolean }[];
  error: string | null;
}> {
  try {
    const stripe = getStripe();
    const labels = priceLabelMap();

    const subs = await stripe.subscriptions.list({ status: "active", limit: 100 });
    let mrrCents = 0;
    const byTier: Record<string, number> = {};
    for (const sub of subs.data) {
      for (const item of sub.items.data) {
        const price = item.price;
        const qty = item.quantity ?? 1;
        const amount = (price.unit_amount ?? 0) * qty;
        if (price.recurring?.interval === "month") mrrCents += amount / (price.recurring.interval_count ?? 1);
        else if (price.recurring?.interval === "year") mrrCents += amount / (12 * (price.recurring.interval_count ?? 1));
        const label = labels[price.id] ?? price.nickname ?? price.id;
        byTier[label] = (byTier[label] ?? 0) + qty;
      }
    }

    const promos = await stripe.promotionCodes.list({ limit: 100 });
    const promoUsage = promos.data.map((p) => ({ code: p.code, times_redeemed: p.times_redeemed, active: p.active }));

    return {
      activeSubscribers: {
        total: subs.data.length,
        byTier: Object.entries(byTier).map(([label, count]) => ({ label, count })),
      },
      mrrCents: Math.round(mrrCents),
      promoUsage,
      error: null,
    };
  } catch (e) {
    return {
      activeSubscribers: { total: 0, byTier: [] },
      mrrCents: 0,
      promoUsage: [],
      error: e instanceof Error ? e.message : "stripe_error",
    };
  }
}
