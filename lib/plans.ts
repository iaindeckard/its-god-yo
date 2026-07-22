/**
 * Plan catalog — the single source of truth the UI reads. Price IDs come from
 * NEXT_PUBLIC_* env (see .env.example / config/stripe-prices.json); the literals
 * here are the committed TEST-mode (sandbox account) fallbacks so the app runs
 * without a .env.local during local dev. `plan_key` + `base_price_id` are exactly
 * what the submit-consent Edge Function expects.
 *
 * IMPORTANT: each price MUST reference process.env.NEXT_PUBLIC_PRICE_* as a
 * LITERAL member expression (not via a dynamic `process.env[key]` helper). Next.js
 * only inlines literal NEXT_PUBLIC_* references into the CLIENT bundle; a dynamic
 * lookup silently resolves to the fallback on the client, which would ship the
 * sandbox price IDs to a live build. Keep these literal.
 *
 * DM-from-Him is ALWAYS its own separate monthly item ($1.99/mo), independent of
 * the base plan's cadence — never folded into the base price.
 */

export const DM_ADDON = {
  plan_key: "dm_addon_monthly",
  price_id: process.env.NEXT_PUBLIC_PRICE_DM_ADDON_MONTHLY || "price_1TvePrGYyfOIjQvM1w2NJZ2u",
  amount: 1.99,
  interval: "month" as const,
};

// Family plan: base $99/yr covers up to FAMILY_BASE_TEENS confirmed teens; each
// additional confirmed teen is $28/yr on the extra-teen line (added at that
// teen's own 7-day trial-end). Fallback = sandbox TEST price; prod injects the
// live price via NEXT_PUBLIC_PRICE_FAMILY_EXTRA_TEEN.
export const FAMILY_BASE_TEENS = 2;
export const FAMILY_EXTRA_TEEN = {
  price_id: process.env.NEXT_PUBLIC_PRICE_FAMILY_EXTRA_TEEN || "price_1TvzNeGYyfOIjQvMpKxXkm4m",
  amount: 28,
  interval: "year" as const,
};

export type PlanKey =
  | "individual_monthly"
  | "individual_annual"
  | "family_annual"
  | "gift_annual"
  | "group"
  | "group_301plus";

export interface Plan {
  key: PlanKey;
  price_id: string | null; // null => contact-us (no self-serve price)
  amount: number | null; // display amount (per interval, or per-teen for group)
  interval: "month" | "year" | null;
  per?: "teen";
}

export const PLANS: Record<Exclude<PlanKey, "group">, Plan> & { individual_monthly: Plan } = {
  individual_monthly: {
    key: "individual_monthly",
    price_id: process.env.NEXT_PUBLIC_PRICE_INDIVIDUAL_MONTHLY || "price_1TvePoGYyfOIjQvMi7r2wXD3",
    amount: 6.99,
    interval: "month",
  },
  individual_annual: {
    key: "individual_annual",
    price_id: process.env.NEXT_PUBLIC_PRICE_INDIVIDUAL_ANNUAL || "price_1TvePpGYyfOIjQvMDxEJsqNe",
    amount: 59.0,
    interval: "year",
  },
  family_annual: {
    key: "family_annual",
    price_id: process.env.NEXT_PUBLIC_PRICE_FAMILY_ANNUAL || "price_1TvePpGYyfOIjQvMDbu9cFli",
    amount: 99.0,
    interval: "year",
  },
  gift_annual: {
    key: "gift_annual",
    price_id: process.env.NEXT_PUBLIC_PRICE_GIFT_ANNUAL || "price_1TvePqGYyfOIjQvMErLxfVjd",
    amount: 59.0,
    interval: "year",
  },
  group_301plus: {
    key: "group_301plus",
    price_id: null,
    amount: null,
    interval: null,
  },
};

/**
 * Group is per-teen/year, priced in bands. Choosing a teen count picks the band
 * price; 301+ has no self-serve price (contact-us). We send the BAND key as the
 * plan_key + its price_id as base_price_id, plus group_teen_count.
 */
export interface GroupBand {
  band_key: "group_1_50" | "group_51_150" | "group_151_300";
  price_id: string;
  amount: number; // per teen / year
  min: number;
  max: number;
}
export const GROUP_BANDS: GroupBand[] = [
  { band_key: "group_1_50", price_id: process.env.NEXT_PUBLIC_PRICE_GROUP_1_50 || "price_1TvePqGYyfOIjQvM4sSSy0mi", amount: 28, min: 1, max: 50 },
  { band_key: "group_51_150", price_id: process.env.NEXT_PUBLIC_PRICE_GROUP_51_150 || "price_1TvePqGYyfOIjQvMNuPHE8SF", amount: 32, min: 51, max: 150 },
  { band_key: "group_151_300", price_id: process.env.NEXT_PUBLIC_PRICE_GROUP_151_300 || "price_1TvePrGYyfOIjQvMJUcLgxJW", amount: 36, min: 151, max: 300 },
];

export const GROUP_CONTACT_THRESHOLD = 301;

export function bandForCount(count: number): GroupBand | null {
  return GROUP_BANDS.find((b) => count >= b.min && count <= b.max) ?? null;
}

export const REFERRAL_DISCOUNT = 0.1; // 10% off
