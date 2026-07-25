// Verify the IGY price catalog resolves under the current STRIPE_SECRET_KEY.
// Run with the SANDBOX TEST key (acct_1TvPGDGYyfOIjQvM) — the same key prod uses:
//
//   STRIPE_SECRET_KEY=sk_test_... node scripts/verify-prices.mjs
//
// Prints a BEFORE/AFTER table: the LIVE price IDs (what prod had before the fix,
// expected to 404 under a test key) vs the SANDBOX price IDs (what we just set in
// Vercel, expected to resolve). "AFTER all OK" == mismatch fixed.

import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) { console.error("ERROR: set STRIPE_SECRET_KEY (the IGY sandbox TEST key)."); process.exit(1); }
if (!key.includes("_test_")) {
  console.error(`REFUSING: key prefix "${key.slice(0, 8)}" is not a test key. Use the sandbox TEST key.`);
  process.exit(1);
}
const stripe = new Stripe(key, { apiVersion: "2025-02-24.acacia" });

// BEFORE = LIVE account price IDs (config/stripe-prices.json .live). family_extra_teen
// has no committed live ID (was never in the catalog) — shown as such.
const BEFORE = {
  individual_monthly: "price_1TvfLzGZ9WDMHywoITvwlPHf",
  individual_annual:  "price_1TvfLzGZ9WDMHywoIaGqhbXd",
  family_annual:      "price_1TvfLzGZ9WDMHywoF4REANU9",
  gift_annual:        "price_1TvfM0GZ9WDMHywotCWp8Lrm",
  group_1_50:         "price_1TvfM0GZ9WDMHywoGY7AnnTU",
  group_51_150:       "price_1TvfM1GZ9WDMHywoFuQyW2X8",
  group_151_300:      "price_1TvfM1GZ9WDMHywoXpTFTFrI",
  dm_addon_monthly:   "price_1TvfM1GZ9WDMHywoXcIddFVk",
  family_extra_teen:  null, // no committed live ID
};

// AFTER = SANDBOX price IDs just written to Vercel Production. family_extra_teen is
// the lib/plans.ts fallback, which is NOT in config/stripe-prices.json — this run is
// what confirms whether it actually exists in the sandbox account.
const AFTER = {
  individual_monthly: "price_1TvePoGYyfOIjQvMi7r2wXD3",
  individual_annual:  "price_1TvePpGYyfOIjQvMDxEJsqNe",
  family_annual:      "price_1TvePpGYyfOIjQvMDbu9cFli",
  gift_annual:        "price_1TvePqGYyfOIjQvMErLxfVjd",
  group_1_50:         "price_1TvePqGYyfOIjQvM4sSSy0mi",
  group_51_150:       "price_1TvePqGYyfOIjQvMNuPHE8SF",
  group_151_300:      "price_1TvePrGYyfOIjQvMJUcLgxJW",
  dm_addon_monthly:   "price_1TvePrGYyfOIjQvM1w2NJZ2u",
  family_extra_teen:  "price_1TvzNeGYyfOIjQvMpKxXkm4m", // plans.ts fallback (unconfirmed)
};

async function probe(id) {
  if (!id) return { ok: null, note: "no committed id" };
  try {
    const p = await stripe.prices.retrieve(id);
    const amt = (p.unit_amount ?? 0) / 100;
    const cad = p.recurring?.interval ?? p.type;
    return { ok: true, note: `active=${p.active} $${amt}/${cad}` };
  } catch (e) {
    return { ok: false, note: `${e.code || e.type}: ${e.message?.split(".")[0]}` };
  }
}

async function run(label, map) {
  console.log(`\n=== ${label} ===`);
  let pass = 0, fail = 0;
  for (const [plan, id] of Object.entries(map)) {
    const r = await probe(id);
    const mark = r.ok === true ? "✓ OK   " : r.ok === false ? "✗ FAIL " : "· skip ";
    if (r.ok === true) pass++; if (r.ok === false) fail++;
    console.log(`${mark} ${plan.padEnd(20)} ${(id || "—").padEnd(34)} ${r.note}`);
  }
  return { pass, fail };
}

const acct = await stripe.accounts.retrieve().catch(() => null);
console.log(`Key: ${key.slice(0, 12)}…  account: ${acct?.id || "(restricted key — cannot read account)"}`);

const before = await run("BEFORE — LIVE price IDs (what prod had; should 404 under test key)", BEFORE);
const after  = await run("AFTER — SANDBOX price IDs (just set in Vercel; should all resolve)", AFTER);

console.log(`\nSummary: BEFORE ${before.pass} ok / ${before.fail} fail  |  AFTER ${after.pass} ok / ${after.fail} fail`);
console.log(after.fail === 0
  ? "✅ AFTER all OK — no resource_missing. Mismatch fixed."
  : "⚠️  AFTER has failures — investigate the FAIL rows above (likely family_extra_teen).");
