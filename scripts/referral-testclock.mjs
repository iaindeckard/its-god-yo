// Phase 7 referral test-clock harness (Stripe side).
// Run with the SANDBOX TEST key (the one prod uses): acct_1TvPGDGYyfOIjQvM.
//
//   STRIPE_SECRET_KEY=sk_test_... node scripts/referral-testclock.mjs setup
//   STRIPE_SECRET_KEY=sk_test_... node scripts/referral-testclock.mjs selfref <existing cus...>
//   STRIPE_SECRET_KEY=sk_test_... node scripts/referral-testclock.mjs advance <clockId>
//   STRIPE_SECRET_KEY=sk_test_... node scripts/referral-testclock.mjs lastinvoice <subId>
//   STRIPE_SECRET_KEY=sk_test_... node scripts/referral-testclock.mjs balances <cus...>
//   STRIPE_SECRET_KEY=sk_test_... node scripts/referral-testclock.mjs refund <paymentIntentId>
//   STRIPE_SECRET_KEY=sk_test_... node scripts/referral-testclock.mjs clocks
//   STRIPE_SECRET_KEY=sk_test_... node scripts/referral-testclock.mjs cleanup <clockId>
//
// The events from these actions hit the DEPLOYED prod webhook (test mode), which
// runs the referral conversion/clawback. Claude seeds the DB + verifies between
// steps via the Supabase MCP.

import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) { console.error("ERROR: set STRIPE_SECRET_KEY (the sandbox TEST key)."); process.exit(1); }
// Hard safety: never run against a live key (avoids real charges).
if (!key.includes("_test_")) {
  console.error(`REFUSING: key prefix "${key.slice(0, 8)}" is not a test key. Use the sandbox TEST key.`);
  process.exit(1);
}

const stripe = new Stripe(key, { apiVersion: "2025-02-24.acacia" });
const FAMILY_PRICE = process.env.FAMILY_PRICE || "price_1TvePpGYyfOIjQvMDbu9cFli"; // sandbox family annual ($99/yr)
const DAY = 86400;

async function newPaidCustomer(clockId, label) {
  const customer = await stripe.customers.create({ test_clock: clockId, description: label });
  const pm = await stripe.paymentMethods.create({ type: "card", card: { token: "tok_visa" } });
  await stripe.paymentMethods.attach(pm.id, { customer: customer.id });
  await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: pm.id } });
  return { customer, pm };
}

async function setup() {
  const now = Math.floor(Date.now() / 1000);
  const clock = await stripe.testHelpers.testClocks.create({ frozen_time: now, name: "igy-referral-phase7" });

  // Referrer: active family sub (so they have a computable monthly value + a live sub to credit).
  const { customer: referrer, pm: rpm } = await newPaidCustomer(clock.id, "IGY-REF-TEST referrer");
  const referrerSub = await stripe.subscriptions.create({
    customer: referrer.id, items: [{ price: FAMILY_PRICE }], default_payment_method: rpm.id, off_session: true,
  });

  // Referee: family sub with a 7-day trial (so the first REAL charge is a subscription_cycle after we advance).
  const { customer: referee, pm: epm } = await newPaidCustomer(clock.id, "IGY-REF-TEST referee");
  const refereeSub = await stripe.subscriptions.create({
    customer: referee.id, items: [{ price: FAMILY_PRICE }], default_payment_method: epm.id,
    trial_period_days: 7, off_session: true, metadata: { igy_test: "referral" },
  });

  console.log(JSON.stringify({
    clock: clock.id,
    referrer: referrer.id,
    referrerSub: referrerSub.id,
    referee: referee.id,
    refereeSub: refereeSub.id,
    trialEnd: refereeSub.trial_end,
  }, null, 2));
}

async function refereeonly() {
  // Cap test: a brand-new referee only (the referrer already exists from a prior
  // run). New clock + trialing family sub, so advancing past the trial fires the
  // first real subscription_cycle invoice -> prod webhook -> conversion.
  const now = Math.floor(Date.now() / 1000);
  const clock = await stripe.testHelpers.testClocks.create({ frozen_time: now, name: "igy-referral-captest" });
  const { customer: referee, pm: epm } = await newPaidCustomer(clock.id, "IGY-REF-TEST cap referee");
  const refereeSub = await stripe.subscriptions.create({
    customer: referee.id, items: [{ price: FAMILY_PRICE }], default_payment_method: epm.id,
    trial_period_days: 7, off_session: true, metadata: { igy_test: "referral-cap" },
  });
  console.log(JSON.stringify({
    clock: clock.id,
    referee: referee.id,
    refereeSub: refereeSub.id,
    trialEnd: refereeSub.trial_end,
  }, null, 2));
}

async function selfref(customerId) {
  // Self-referral test: create a NEW trialing family sub for an EXISTING customer
  // (reusing their default PM + test clock) so the SAME customer id is both the
  // referrer (via the seeded event) and the referee (the invoice's customer).
  // Advancing past the trial fires the first subscription_cycle invoice -> prod
  // webhook -> onRefereePaidConversion, where the guard (referrer===referee) voids.
  if (!customerId) { console.error("usage: selfref <existing customerId>"); process.exit(1); }
  const customer = await stripe.customers.retrieve(customerId);
  if (customer.deleted) { console.error(`customer ${customerId} is deleted in Stripe — use 'refereeonly' (fresh customer) instead`); process.exit(1); }
  const clockId = customer.test_clock;
  if (!clockId) { console.error(`customer ${customerId} is not on a test clock — cannot advance it; use 'refereeonly' instead`); process.exit(1); }
  const sub = await stripe.subscriptions.create({
    customer: customerId, items: [{ price: FAMILY_PRICE }],
    trial_period_days: 7, off_session: true, metadata: { igy_test: "referral-selfref" },
  });
  console.log(JSON.stringify({
    clock: clockId,
    selfCustomer: customerId,
    selfSub: sub.id,
    trialEnd: sub.trial_end,
  }, null, 2));
}

async function advance(clockId) {
  const clock = await stripe.testHelpers.testClocks.retrieve(clockId);
  const target = clock.frozen_time + 8 * DAY; // past the 7-day trial
  await stripe.testHelpers.testClocks.advance(clockId, { frozen_time: target });
  let c;
  do {
    await new Promise((r) => setTimeout(r, 3000));
    c = await stripe.testHelpers.testClocks.retrieve(clockId);
    process.stdout.write(`.${c.status}`);
  } while (c.status === "advancing");
  console.log(`\nClock advanced to ${target}. status=${c.status}. Give the webhook ~15-30s, then Claude verifies the DB.`);
}

async function lastinvoice(subId) {
  const inv = await stripe.invoices.list({ subscription: subId, limit: 3 });
  for (const i of inv.data) {
    console.log(JSON.stringify({ id: i.id, billing_reason: i.billing_reason, amount_paid: i.amount_paid, charge: i.charge, payment_intent: i.payment_intent, status: i.status }));
  }
}

async function balances(...ids) {
  for (const id of ids) {
    const c = await stripe.customers.retrieve(id);
    console.log(`${id}  balance_cents=${c.balance}  ${c.balance < 0 ? "(CREDIT ✓)" : ""}`);
  }
}

async function refund(pi) {
  const r = await stripe.refunds.create({ payment_intent: pi });
  console.log(`refunded ${r.id} status=${r.status} — should trigger charge.refunded -> clawback`);
}

async function clocks() {
  // List all test clocks so you can find the phase-7 ones and `cleanup <id>` each.
  const list = await stripe.testHelpers.testClocks.list({ limit: 100 });
  if (!list.data.length) { console.log("(no test clocks)"); return; }
  for (const c of list.data) {
    console.log(`${c.id}  name=${JSON.stringify(c.name)}  status=${c.status}  frozen_time=${c.frozen_time}`);
  }
}

async function cleanup(clockId) {
  await stripe.testHelpers.testClocks.del(clockId); // cascades: deletes its customers + subscriptions
  console.log(`deleted test clock ${clockId} and all its customers/subscriptions`);
}

const [cmd, ...args] = process.argv.slice(2);
const fns = { setup, refereeonly, selfref, advance, lastinvoice, balances, refund, clocks, cleanup };
if (!fns[cmd]) { console.error(`Unknown command "${cmd}". One of: ${Object.keys(fns).join(", ")}`); process.exit(1); }
fns[cmd](...args).catch((e) => { console.error("ERROR:", e?.message || e); process.exit(1); });
