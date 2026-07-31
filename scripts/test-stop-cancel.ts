/**
 * MANUAL integration test for the SMS STOP -> cancel billing fix.
 *
 * ⚠️  DO NOT run in CI and DO NOT run against production. This script creates a
 *     REAL (test-mode) Stripe subscription and writes throwaway rows to the
 *     configured Supabase project. Use a TEST Stripe key and a non-prod/service
 *     role. It cleans up the rows it creates on success.
 *
 * WHAT IT VERIFIES
 *   1. A confirmed, active individual subscriber who texts STOP:
 *        - consent_log row       -> consent_status = 'opted_out'
 *        - pending_signups row   -> status         = 'canceled'
 *        - Stripe subscription   -> status         = 'canceled'
 *        - is ABSENT from daily_send_audience
 *   2. Idempotency: sending STOP a second time does not throw and end-state holds.
 *   3. Family: one teen STOP (of two confirmed) leaves the base sub ACTIVE
 *      (partial opt-out); the LAST teen STOP cancels the base (full opt-out).
 *
 * PREREQUISITES (env)
 *   STRIPE_SECRET_KEY=sk_test_...            # TEST MODE ONLY
 *   NEXT_PUBLIC_SUPABASE_URL / SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   A valid test payment method + price ids for the account (see PM/PRICE consts).
 *
 * HOW TO RUN
 *   The lib/ modules use `import "server-only"`, which throws outside a React
 *   Server Component. Resolve it to its empty export via the react-server
 *   condition:
 *
 *     NODE_OPTIONS='--conditions=react-server' \
 *       npx tsx scripts/test-stop-cancel.ts
 *
 *   (Install tsx if needed: `npm i -D tsx`.)
 */

import { getStripe } from "../lib/stripe";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { processInboundReply } from "../lib/twilioInbound";

// ---- Test fixtures. Replace with real TEST-mode ids for the account. ----
const TEST_PM = process.env.TEST_PAYMENT_METHOD_ID || "pm_card_visa"; // Stripe test PM
const TEST_BASE_PRICE = process.env.TEST_BASE_PRICE_ID || ""; // an individual price id
const TEST_FAMILY_PRICE = process.env.TEST_FAMILY_PRICE_ID || ""; // the family base price id

// consent_log NOT-NULL columns the real submit-consent always provides.
const REQUIRED_CONSENT = {
  attestation_text: "TEST attestation", attestation_text_version: "test-v1",
  disclosure_text: "TEST disclosure", disclosure_text_version: "test-v1",
};

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  console.log(`  ok: ${msg}`);
}

async function inAudience(signupId: string): Promise<boolean> {
  const admin = getSupabaseAdmin();
  // daily_send_audience joins consent_log + pending_signups; presence == sendable.
  const { data } = await admin.from("daily_send_audience").select("consent_id").eq("pending_signup_id", signupId);
  return (data ?? []).length > 0;
}

async function makeCustomer(): Promise<{ customer: string; pm: string }> {
  const stripe = getStripe();
  const cust = await stripe.customers.create({ description: "IGY STOP-cancel integration test" });
  // Create a FRESH test PaymentMethod per customer (a shared token like pm_card_visa
  // can only live on one customer). tok_visa is Stripe's canonical test card token.
  const pm = TEST_PM.startsWith("pm_") && TEST_PM !== "pm_card_visa"
    ? await stripe.paymentMethods.retrieve(TEST_PM)
    : await stripe.paymentMethods.create({ type: "card", card: { token: "tok_visa" } });
  await stripe.paymentMethods.attach(pm.id, { customer: cust.id });
  await stripe.customers.update(cust.id, { invoice_settings: { default_payment_method: pm.id } });
  return { customer: cust.id, pm: pm.id };
}

async function testIndividualStop() {
  console.log("\n[1] individual: confirmed+active subscriber texts STOP");
  const admin = getSupabaseAdmin();
  const stripe = getStripe();
  const phone = "+15550001111";
  const { customer, pm } = await makeCustomer();

  // Live (trialing) subscription, mimicking a confirmed individual subscriber.
  const sub = await stripe.subscriptions.create({
    customer,
    items: [{ price: TEST_BASE_PRICE }],
    trial_period_days: 7,
    default_payment_method: pm,
    off_session: true,
  });

  const { data: consent, error: cErr } = await admin.from("consent_log").insert({
    recipient_phone: phone, recipient_first_name: "Test", language: "en",
    consent_type: "primary_subscriber", consent_status: "confirmed",
    ...REQUIRED_CONSENT,
  }).select("id").single();
  if (cErr || !consent) throw new Error(`individual consent insert failed: ${cErr?.message}`);

  const { data: signup, error: sErr } = await admin.from("pending_signups").insert({
    language: "en", plan_key: "individual", base_price_id: TEST_BASE_PRICE,
    teen_consent_id: consent.id, stripe_customer_id: customer,
    stripe_payment_method_id: pm, stripe_subscription_id: sub.id,
    status: "subscription_created",
  }).select("id").single();
  if (sErr || !signup) throw new Error(`individual signup insert failed: ${sErr?.message}`);
  await admin.from("consent_log").update({ pending_signup_id: signup!.id }).eq("id", consent!.id);

  const res = await processInboundReply(phone, "STOP");
  assert(res.action === "opted_out", "STOP returns opted_out");

  const { data: c } = await admin.from("consent_log").select("consent_status").eq("id", consent!.id).single();
  assert(c!.consent_status === "opted_out", "consent_log -> opted_out");
  const { data: s } = await admin.from("pending_signups").select("status").eq("id", signup!.id).single();
  assert(s!.status === "canceled", "pending_signups -> canceled");
  const fresh = await stripe.subscriptions.retrieve(sub.id);
  assert(fresh.status === "canceled", "stripe subscription -> canceled");
  assert(!(await inAudience(signup!.id)), "absent from daily_send_audience");

  // Idempotency: STOP again must not throw and end-state holds.
  const res2 = await processInboundReply(phone, "STOP");
  assert(res2.action === "opted_out", "second STOP still opted_out (idempotent)");
  const fresh2 = await stripe.subscriptions.retrieve(sub.id);
  assert(fresh2.status === "canceled", "stripe still canceled after 2nd STOP");

  // cleanup
  await admin.from("pending_signups").delete().eq("id", signup!.id);
  await admin.from("consent_log").delete().eq("id", consent!.id);
  await stripe.customers.del(customer);
}

async function testFamilyPartialThenFull() {
  console.log("\n[2] family: partial opt-out keeps base; full opt-out cancels base");
  const admin = getSupabaseAdmin();
  const stripe = getStripe();
  const phoneA = "+15550002222";
  const phoneB = "+15550003333";
  const { customer, pm } = await makeCustomer();

  const sub = await stripe.subscriptions.create({
    customer,
    items: [{ price: TEST_FAMILY_PRICE, quantity: 1 }],
    trial_period_days: 7,
    default_payment_method: pm,
    off_session: true,
  });

  // Teens first (pending_signups.teen_consent_id is NOT NULL), then link back.
  const mkTeen = async (phone: string, i: number) => {
    const { data, error } = await admin.from("consent_log").insert({
      recipient_phone: phone, recipient_first_name: `Teen${i}`, language: "en",
      consent_type: "family_teen", teen_index: i, consent_status: "confirmed",
      confirmation_reply_at: new Date().toISOString(),
      trial_ends_at: new Date(Date.now() - 1000).toISOString(),
      ...REQUIRED_CONSENT,
    }).select("id").single();
    if (error || !data) throw new Error(`mkTeen insert failed: ${error?.message}`);
    return data.id as string;
  };
  const teenA = await mkTeen(phoneA, 1);
  const teenB = await mkTeen(phoneB, 2);

  const { data: signup, error: sErr } = await admin.from("pending_signups").insert({
    language: "en", plan_key: "family", base_price_id: TEST_FAMILY_PRICE,
    teen_consent_id: teenA,
    stripe_customer_id: customer, stripe_payment_method_id: pm,
    stripe_subscription_id: sub.id, status: "subscription_created",
  }).select("id").single();
  if (sErr || !signup) throw new Error(`family signup insert failed: ${sErr?.message}`);
  await admin.from("consent_log").update({ pending_signup_id: signup!.id }).in("id", [teenA, teenB]);

  // Teen A opts out — base must stay active (teen B still confirmed).
  await processInboundReply(phoneA, "STOP");
  const { data: ca } = await admin.from("consent_log").select("consent_status").eq("id", teenA).single();
  assert(ca!.consent_status === "opted_out", "teen A -> opted_out");
  const midSub = await stripe.subscriptions.retrieve(sub.id);
  assert(midSub.status !== "canceled", "base subscription still ACTIVE after partial opt-out");
  const { data: sMid } = await admin.from("pending_signups").select("status").eq("id", signup!.id).single();
  assert(sMid!.status !== "canceled", "pending_signups not canceled after partial opt-out");

  // Teen B (the last) opts out — base must now cancel.
  await processInboundReply(phoneB, "STOP");
  const { data: cb } = await admin.from("consent_log").select("consent_status").eq("id", teenB).single();
  assert(cb!.consent_status === "opted_out", "teen B -> opted_out");
  const finalSub = await stripe.subscriptions.retrieve(sub.id);
  assert(finalSub.status === "canceled", "base subscription CANCELED after full opt-out");
  const { data: sFin } = await admin.from("pending_signups").select("status").eq("id", signup!.id).single();
  assert(sFin!.status === "canceled", "pending_signups -> canceled after full opt-out");

  // cleanup — delete the signup BEFORE the teen consents: pending_signups.teen_consent_id
  // is a NOT-NULL FK to consent_log, so consents can't be removed while the signup exists.
  await admin.from("pending_signups").delete().eq("id", signup!.id);
  await admin.from("consent_log").delete().in("id", [teenA, teenB]);
  await stripe.customers.del(customer);
}

async function testFamilyPendingTeenBlocksCancel() {
  console.log("\n[3] family: a still-PENDING teen blocks base cancel (finding #3)");
  const admin = getSupabaseAdmin();
  const stripe = getStripe();
  const phoneA = "+15550004444"; // confirmed teen
  const phoneB = "+15550005555"; // still pending_confirmation
  const { customer, pm } = await makeCustomer();

  const sub = await stripe.subscriptions.create({
    customer,
    items: [{ price: TEST_FAMILY_PRICE, quantity: 1 }],
    trial_period_days: 7,
    default_payment_method: pm,
    off_session: true,
  });

  const mkTeen = async (phone: string, i: number, status: string) => {
    const { data, error } = await admin.from("consent_log").insert({
      recipient_phone: phone, recipient_first_name: `Teen${i}`, language: "en",
      consent_type: "family_teen", teen_index: i, consent_status: status,
      confirmation_reply_at: status === "confirmed" ? new Date().toISOString() : null,
      trial_ends_at: status === "confirmed" ? new Date(Date.now() - 1000).toISOString() : null,
      ...REQUIRED_CONSENT,
    }).select("id").single();
    if (error || !data) throw new Error(`mkTeen insert failed: ${error?.message}`);
    return data.id as string;
  };
  const teenConfirmed = await mkTeen(phoneA, 1, "confirmed");
  const teenPending = await mkTeen(phoneB, 2, "pending_confirmation");

  const { data: signup, error: sErr } = await admin.from("pending_signups").insert({
    language: "en", plan_key: "family", base_price_id: TEST_FAMILY_PRICE,
    teen_consent_id: teenConfirmed,
    stripe_customer_id: customer, stripe_payment_method_id: pm,
    stripe_subscription_id: sub.id, status: "subscription_created",
  }).select("id").single();
  if (sErr || !signup) throw new Error(`family signup insert failed: ${sErr?.message}`);
  await admin.from("consent_log").update({ pending_signup_id: signup!.id }).in("id", [teenConfirmed, teenPending]);

  // The ONLY confirmed teen opts out while the other teen is still pending — the base
  // must NOT cancel, because the pending teen could still confirm (finding #3).
  await processInboundReply(phoneA, "STOP");
  const { data: ca } = await admin.from("consent_log").select("consent_status").eq("id", teenConfirmed).single();
  assert(ca!.consent_status === "opted_out", "confirmed teen -> opted_out");
  const { data: cb } = await admin.from("consent_log").select("consent_status").eq("id", teenPending).single();
  assert(cb!.consent_status === "pending_confirmation", "pending teen stays pending_confirmation");
  const stillSub = await stripe.subscriptions.retrieve(sub.id);
  assert(stillSub.status !== "canceled", "base NOT canceled while a teen is still pending (finding #3)");
  const { data: s } = await admin.from("pending_signups").select("status").eq("id", signup!.id).single();
  assert(s!.status !== "canceled", "pending_signups NOT canceled while a teen is still pending");

  // cleanup — signup before consents (FK)
  await admin.from("pending_signups").delete().eq("id", signup!.id);
  await admin.from("consent_log").delete().in("id", [teenConfirmed, teenPending]);
  await stripe.customers.del(customer);
}

async function main() {
  if (!TEST_BASE_PRICE || !TEST_FAMILY_PRICE) {
    throw new Error("Set TEST_BASE_PRICE_ID and TEST_FAMILY_PRICE_ID (test-mode price ids) before running.");
  }
  const key = process.env.STRIPE_SECRET_KEY || "";
  if (!key.startsWith("sk_test_")) {
    throw new Error("Refusing to run: STRIPE_SECRET_KEY must be a TEST key (sk_test_...).");
  }
  await testIndividualStop();
  await testFamilyPartialThenFull();
  await testFamilyPendingTeenBlocksCancel();
  console.log("\nAll STOP-cancel integration assertions passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
