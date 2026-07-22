import { PLANS, GROUP_BANDS } from "./plans";

/**
 * Customer TIERS as the Promo Code Studio + ARR Impact Simulator think about
 * them. These map onto the checkout `plan_key`s but are a coarser, business-
 * facing grouping (spec: "Individual monthly, Individual annual, Family, Gift,
 * Group"). A promo code stores which tier KEYS it applies to (metadata
 * allowed_tiers); the simulator models ARR impact per tier.
 *
 * `annualUnitCents` is the representative annual revenue of ONE redemption in
 * that tier, used only for ARR-impact math (discount depth × annual value ×
 * expected redemptions). Individual-monthly is annualized (×12). Group is
 * inherently per-teen and per-contract, so its unit value is a representative
 * assumption the simulator lets you edit.
 */
export interface PromoTier {
  key: string; // stable id stored in allowed_tiers
  label: string;
  planKeys: string[]; // checkout plan_key(s) that belong to this tier (enforcement)
  annualUnitCents: number; // representative annual value of one redemption
  defaultExpectedRedemptions: number; // PRE-LAUNCH PLACEHOLDER — see note below
}

const cents = (dollars: number) => Math.round(dollars * 100);

// Representative group contract used for ARR math: mid-size org on the entry
// band. Editable in the simulator UI.
const GROUP_REPRESENTATIVE_TEENS = 50;
const groupBand0 = GROUP_BANDS[0];

/**
 * PRE-LAUNCH default expected-redemption volumes. The spec is explicit that once
 * IGY has live customers these default from real Stripe/subscriber data, and
 * pre-launch they default from the five-year forecast's Year-1 subscriber
 * projections. IGY has no live customers yet AND the forecast's precise per-tier
 * Year-1 split was not available at build time, so these are deliberately
 * conservative, clearly-labeled placeholders — every one is editable in the UI.
 * Replace this single block with the forecast's Year-1 numbers when handed over.
 */
export const TIERS: PromoTier[] = [
  {
    key: "individual_monthly",
    label: "Individual (monthly)",
    planKeys: ["individual_monthly"],
    annualUnitCents: cents((PLANS.individual_monthly.amount ?? 6.99) * 12),
    defaultExpectedRedemptions: 100,
  },
  {
    key: "individual_annual",
    label: "Individual (annual)",
    planKeys: ["individual_annual"],
    annualUnitCents: cents(PLANS.individual_annual.amount ?? 59),
    defaultExpectedRedemptions: 50,
  },
  {
    key: "family",
    label: "Family",
    planKeys: ["family_annual"],
    annualUnitCents: cents(PLANS.family_annual.amount ?? 99),
    defaultExpectedRedemptions: 25,
  },
  {
    key: "gift",
    label: "Gift",
    planKeys: ["gift_annual"],
    annualUnitCents: cents(PLANS.gift_annual.amount ?? 59),
    defaultExpectedRedemptions: 15,
  },
  {
    key: "group",
    label: "Group",
    planKeys: ["group_1_50", "group_51_150", "group_151_300", "group_301plus"],
    annualUnitCents: cents((groupBand0?.amount ?? 28) * GROUP_REPRESENTATIVE_TEENS),
    defaultExpectedRedemptions: 3,
  },
];

export const TIER_KEYS = TIERS.map((t) => t.key);

/** Map a checkout plan_key back to its coarse tier key (or null if unknown). */
export function tierForPlanKey(planKey: string | null | undefined): string | null {
  if (!planKey) return null;
  const t = TIERS.find((t) => t.planKeys.includes(planKey));
  return t?.key ?? null;
}
