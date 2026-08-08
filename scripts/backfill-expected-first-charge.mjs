// Backfill pending_signups.expected_first_charge_cents for signups that predate the
// cause-promotion tracker's capture-at-signup (migration 20260808150000). Only the
// POTENTIAL figure needs this, and potential only applies to IN-TRIAL subs (no settled
// payment yet), so we only backfill those — already-charged subs are REALIZED off
// subscription_payments and never use this column. For each in-trial sub we read the
// exact expected charge (base + add-on, post promo discount) from Stripe's upcoming
// invoice, the same source the signup flow now captures live. Best-effort per row.
//
// Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY.
// Usage: node scripts/backfill-expected-first-charge.mjs   (add --commit to write)

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const COMMIT = process.argv.includes("--commit");
const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://bkwtlfkhfbfyzgnozixw.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Subscriptions that already have a settled payment (→ REALIZED, don't need potential).
const { data: paid } = await supa
  .from("subscription_payments")
  .select("stripe_subscription_id")
  .eq("livemode", true)
  .not("stripe_subscription_id", "is", null);
const paidSubs = new Set((paid ?? []).map((r) => r.stripe_subscription_id));

// Candidates: have a subscription, no expected charge captured yet, not cancelled.
const { data: rows, error } = await supa
  .from("pending_signups")
  .select("id, stripe_subscription_id, stripe_customer_id, status, expected_first_charge_cents")
  .not("stripe_subscription_id", "is", null)
  .is("expected_first_charge_cents", null)
  .neq("status", "canceled");
if (error) { console.error("query failed:", error.message); process.exit(1); }

const candidates = (rows ?? []).filter((r) => !paidSubs.has(r.stripe_subscription_id));
console.log(`${candidates.length} in-trial signup(s) to backfill${COMMIT ? " (COMMIT)" : " (dry run)"}.`);

let done = 0;
for (const r of candidates) {
  try {
    const upcoming = await stripe.invoices.retrieveUpcoming({
      customer: r.stripe_customer_id,
      subscription: r.stripe_subscription_id,
    });
    const cents = typeof upcoming?.total === "number" ? upcoming.total : null;
    if (cents == null) { console.log(`  ${r.id}: no upcoming total, skipped`); continue; }
    console.log(`  ${r.id}: expected_first_charge_cents=${cents}`);
    if (COMMIT) {
      const { error: uErr } = await supa.from("pending_signups").update({ expected_first_charge_cents: cents }).eq("id", r.id);
      if (uErr) { console.error(`  ${r.id}: update failed: ${uErr.message}`); continue; }
    }
    done++;
  } catch (e) {
    console.warn(`  ${r.id}: upcoming invoice failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
console.log(`${COMMIT ? "Updated" : "Would update"} ${done} row(s).`);
