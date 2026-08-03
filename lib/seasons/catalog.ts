import type { SeasonKey } from "./liturgical";

/**
 * Holy Season add-on product catalog — the single source of truth for season
 * pricing the app reads. Mirrors the lib/plans.ts pattern.
 *
 * BILLING MODEL (locked with Iain 2026-08-03): these are NOT Stripe subscriptions.
 * Each is a ONE-TIME Stripe price (recurring=null); the annual "auto-renew" is driven
 * by our own pre-season cron creating an off-session charge on the saved card each
 * year, on the moving liturgical date (Stripe's native intervals can't track a
 * lunar-calculated date — see Phase B). `unitAmountCents` is PER TEEN; the charge
 * quantity scales by teen count, same pattern as DM-from-Him / family_extra_teen.
 *
 * Price IDs: the literals are the committed TEST-mode ids (prod account acct_1TvPFi,
 * test mode), so the app and the Phase B–F e2e tests run without a .env.local. LIVE
 * ids are injected via STRIPE_PRICE_SEASON_* at go-live — NOT minted yet (live prices
 * are immutable and these prices are Twilio-safe but not content-labor-final; see
 * docs/SEASONAL-ADDONS-BUILD-NOTES.md).
 */
export interface SeasonProduct {
  key: SeasonKey;
  label: string;
  cycle: "christmas" | "easter";
  /** Per teen, per year, in cents. */
  unitAmountCents: number;
  lookupKey: string;
  /** Stripe price id (server-side use — off-session charge). Live via env, else test fallback. */
  priceId: string;
  /**
   * Paid-EXCLUSIVE send count per teen per season (free climax days are excluded —
   * they ship via the free pipeline to the whole base). Advent is variable (22–28).
   * Source: docs/SEASONAL-ADDONS-BUILD-NOTES.md.
   */
  paidExclusiveSends: number | "variable";
}

export const SEASON_PRODUCTS: Record<SeasonKey, SeasonProduct> = {
  christmastide: {
    key: "christmastide",
    label: "Christmastide",
    cycle: "christmas",
    unitAmountCents: 499,
    lookupKey: "igy_season_christmastide",
    priceId: process.env.STRIPE_PRICE_SEASON_CHRISTMASTIDE || "price_1U0NMKGZ9WDMHywokA9rPsZu",
    paidExclusiveSends: 11,
  },
  advent: {
    key: "advent",
    label: "Advent",
    cycle: "christmas",
    unitAmountCents: 799,
    lookupKey: "igy_season_advent",
    priceId: process.env.STRIPE_PRICE_SEASON_ADVENT || "price_1U0NMLGZ9WDMHywoJOL34PUw",
    paidExclusiveSends: "variable",
  },
  eastertide: {
    key: "eastertide",
    label: "Eastertide",
    cycle: "easter",
    unitAmountCents: 999,
    lookupKey: "igy_season_eastertide",
    priceId: process.env.STRIPE_PRICE_SEASON_EASTERTIDE || "price_1U0NMMGZ9WDMHywosWf1hE1z",
    paidExclusiveSends: 48,
  },
  lent: {
    key: "lent",
    label: "Lent + Holy Week",
    cycle: "easter",
    unitAmountCents: 1299,
    lookupKey: "igy_season_lent",
    priceId: process.env.STRIPE_PRICE_SEASON_LENT || "price_1U0NMNGZ9WDMHywom7wGDyxV",
    paidExclusiveSends: 39,
  },
};

export const SEASON_KEYS = Object.keys(SEASON_PRODUCTS) as SeasonKey[];
export const seasonProduct = (key: SeasonKey): SeasonProduct => SEASON_PRODUCTS[key];
/** Dollars for display, e.g. "$4.99". */
export const seasonPriceLabel = (key: SeasonKey): string =>
  `$${(SEASON_PRODUCTS[key].unitAmountCents / 100).toFixed(2)}`;
