// Verify the IGY Stripe price catalog resolves under the STRIPE_SECRET_KEY that is
// currently in the environment, and make the REASON for any failure unambiguous.
//
//   STRIPE_SECRET_KEY=... node scripts/verify-prices.mjs
//
// Step 1 identifies which account the key belongs to (id + livemode) WITHOUT ever
// echoing the key — not even a prefix. Steps 2-3 retrieve every configured price for
// that mode, plus the uncommitted family_extra_teen fallback, reporting AUTH /
// PERMISSION / MISSING as visibly DIFFERENT outcomes so an account mismatch
// (resource_missing) is never confused with a bad or under-scoped key.
// Exits non-zero if anything fails.

import Stripe from "stripe";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) { console.error("ERROR: set STRIPE_SECRET_KEY."); process.exit(1); }
const stripe = new Stripe(key, { apiVersion: "2025-02-24.acacia" });

// Never print any part of the key. Stripe's own auth-error messages embed a
// partially-masked key (prefix + last4), so scrub anything key-shaped before logging.
const redact = (s) =>
  String(s ?? "").replace(/(sk|rk|pk)_(live|test)_[A-Za-z0-9*]+/g, "[redacted-key]");
const firstSentence = (m) => redact(m).split(".")[0];

// Map a thrown Stripe error to one of the distinct failure classes.
function classify(e) {
  if (e?.statusCode === 401 || e?.type === "StripeAuthenticationError") return "AUTH";
  if (e?.statusCode === 403 || e?.type === "StripePermissionError")     return "PERMISSION";
  if (e?.code === "resource_missing")                                   return "MISSING";
  return "OTHER";
}
const KINDS = {
  AUTH:       { short: "AUTH ERROR",       desc: "invalid or revoked key" },
  PERMISSION: { short: "PERMISSION ERROR", desc: "restricted key lacks Products/Prices read" },
  MISSING:    { short: "MISSING",          desc: "resource_missing — account mismatch" },
  OTHER:      { short: "ERROR",            desc: "unexpected failure" },
};

let failures = 0;

// ── Step 1: whose account is this key? (id + livemode ONLY; never the key) ──
console.log("=== Stripe account ===");
let livemode = /_live_/.test(key); // fallback only if the account object omits livemode
try {
  const acct = await stripe.accounts.retrieve();
  if (typeof acct.livemode === "boolean") livemode = acct.livemode;
  console.log(`account id : ${acct.id}`);
  console.log(`livemode   : ${livemode}`);
} catch (e) {
  const k = classify(e);
  failures++;
  console.log(`account id : (could not retrieve)`);
  console.log(`livemode   : ${livemode}  (inferred — account call failed)`);
  console.log(`  ${KINDS[k].short} (${KINDS[k].desc}) — ${firstSentence(e.message)}`);
}

// ── Steps 2-3: every configured price for this mode, plus family_extra_teen ──
const here = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(join(here, "..", "config", "stripe-prices.json"), "utf8"));
const section = livemode ? catalog.live : catalog.test_sandbox;

const checks = Object.entries(section.prices).map(([plan, p]) => ({ plan, id: p.price_id }));
// family_extra_teen is the lib/plans.ts fallback and is intentionally NOT in
// config/stripe-prices.json — verify it explicitly. Do NOT create it if it is missing.
checks.push({ plan: "family_extra_teen", id: "price_1TvzNeGYyfOIjQvMpKxXkm4m", extra: true });

console.log(`\n=== Prices (${section.mode} / ${section.account_id}) ===`);
for (const { plan, id, extra } of checks) {
  const tag = extra ? `${plan} (not in config)` : plan;
  try {
    const price = await stripe.prices.retrieve(id);
    const amt = (price.unit_amount ?? 0) / 100;
    const cad = price.recurring?.interval ?? price.type;
    console.log(`✓ ${"OK".padEnd(17)} ${tag.padEnd(30)} ${id.padEnd(34)} active=${price.active} $${amt}/${cad}`);
  } catch (e) {
    const k = classify(e);
    failures++;
    console.log(`✗ ${KINDS[k].short.padEnd(17)} ${tag.padEnd(30)} ${id.padEnd(34)} ${firstSentence(e.message)}`);
    if (extra && k === "MISSING") {
      console.log(`    ↳ family_extra_teen does NOT exist in this account. Not creating it (by design).`);
    }
  }
}

// ── Step 4: non-zero exit if anything failed ──
console.log(failures === 0
  ? "\n✅ All checks passed."
  : `\n⚠️  ${failures} check(s) failed — see the AUTH ERROR / PERMISSION ERROR / MISSING rows above.`);
process.exit(failures === 0 ? 0 : 1);
