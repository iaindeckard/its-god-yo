import "server-only";
import { randomInt } from "crypto";
import type Stripe from "stripe";
import { getStripe } from "./stripe";
import { getSupabaseAdmin } from "./supabaseAdmin";

/**
 * Referral system (Option B) — service layer.
 *
 * Reward = Stripe **customer-balance credit** (NOT a coupon), so it scales to
 * each owner's real plan price and families + churches use the SAME mechanic.
 * Two-sided (give-a-month for the referee / get-a-month for the referrer),
 * propagating (a referee gets their own shareable code once they convert). The
 * referrer reward fires on the referee's PAID conversion and is clawed back if
 * that payment is later refunded/charged back. Cap: MAX_REFERRER_REWARDS_PER_YEAR
 * per rolling trailing-12-months. Mutually exclusive with promo codes (enforced
 * at the checkout/validation layer, not here).
 *
 * Tables (migration 20260724000001_referral_system.sql, service-role only):
 *   referral_codes · referral_events · referral_reward_ledger
 *
 * This module is pure service logic. Phase 3 (checkout) calls
 * findUsableReferralCode + recordReferralAtSignup; Phase 4/5 (the Stripe webhook)
 * call onRefereePaidConversion + onRefereePaymentReversed.
 */

export const MAX_REFERRER_REWARDS_PER_YEAR = 6;
const ROLLING_WINDOW_DAYS = 365;

export type OwnerKind = "family" | "church";

// ─────────────────────────── code generation ───────────────────────────
// Unambiguous alphabet (no 0/O/1/I/L). e.g. "IGY-7GKQ9M2X".
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export function generateReferralCode(): string {
  let body = "";
  for (let i = 0; i < 8; i++) body += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `IGY-${body}`;
}

function isUniqueViolation(err: unknown): boolean {
  return !!err && (err as { code?: string }).code === "23505";
}

// ─────────────────────────── minting / lookup ───────────────────────────

/** Idempotently ensure the owner has an active referral code; returns it. Safe
 *  under races (the partial-unique "one active per owner" index arbitrates). */
export async function mintReferralCode(
  ownerCustomerId: string,
  ownerKind: OwnerKind,
): Promise<{ id: string; code: string }> {
  const admin = getSupabaseAdmin();

  const existing = await getActiveCodeForOwner(ownerCustomerId);
  if (existing) return existing;

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateReferralCode();
    const { data, error } = await admin
      .from("referral_codes")
      .insert({ owner_customer_id: ownerCustomerId, owner_kind: ownerKind, code, active: true })
      .select("id, code")
      .single();
    if (!error && data) return data as { id: string; code: string };
    if (isUniqueViolation(error)) {
      // Either a code collision (regenerate) or an owner-active race (return winner).
      const raced = await getActiveCodeForOwner(ownerCustomerId);
      if (raced) return raced;
      continue;
    }
    if (error) throw new Error(`mintReferralCode failed: ${error.message}`);
  }
  throw new Error("mintReferralCode: exhausted code-generation attempts");
}

export async function getActiveCodeForOwner(
  ownerCustomerId: string,
): Promise<{ id: string; code: string } | null> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("referral_codes")
    .select("id, code")
    .eq("owner_customer_id", ownerCustomerId)
    .eq("active", true)
    .maybeSingle();
  return (data as { id: string; code: string } | null) ?? null;
}

export interface ReferralCodeLookup {
  code_id: string;
  referrer_customer_id: string;
  owner_kind: OwnerKind;
}

/** Validate a customer-entered code. Returns the owner, or null if unknown /
 *  inactive. Self-referral is checked at redemption time (caller knows the
 *  referee), and promo⊕referral exclusivity is enforced in the checkout layer. */
export async function findUsableReferralCode(code: string): Promise<ReferralCodeLookup | null> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("referral_codes")
    .select("id, owner_customer_id, owner_kind")
    .eq("code", code.trim())
    .eq("active", true)
    .maybeSingle();
  if (!data) return null;
  const row = data as { id: string; owner_customer_id: string; owner_kind: OwnerKind };
  return { code_id: row.id, referrer_customer_id: row.owner_customer_id, owner_kind: row.owner_kind };
}

/** Record attribution at signup (pending). One per referee signup (unique). */
export async function recordReferralAtSignup(args: {
  codeId: string;
  referrerCustomerId: string;
  refereePendingSignupId: string;
}): Promise<{ status: "recorded" | "duplicate" }> {
  const admin = getSupabaseAdmin();
  const { error } = await admin.from("referral_events").insert({
    referral_code_id: args.codeId,
    referrer_customer_id: args.referrerCustomerId,
    referee_pending_signup_id: args.refereePendingSignupId,
    status: "pending",
  });
  if (error) {
    if (isUniqueViolation(error)) return { status: "duplicate" };
    throw new Error(`recordReferralAtSignup failed: ${error.message}`);
  }
  return { status: "recorded" };
}

// ─────────────────────────── credit math / Stripe ───────────────────────────

/** Monthly-equivalent value (cents) of a subscription's recurring items, summed
 *  and rounded. Annual prices are divided by 12; monthly pass through. This is
 *  what "one free month" is worth for this subscriber — scales to their real
 *  plan (family or church). */
export function subscriptionMonthlyValueCents(sub: Stripe.Subscription): number {
  let cents = 0;
  for (const item of sub.items.data) {
    const price = item.price;
    const rec = price.recurring;
    if (!rec || price.unit_amount == null) continue;
    const line = price.unit_amount * (item.quantity ?? 1);
    const perCount = rec.interval_count || 1;
    if (rec.interval === "year") cents += line / (12 * perCount);
    else if (rec.interval === "month") cents += line / perCount;
    else if (rec.interval === "week") cents += (line * 52) / 12 / perCount;
    else if (rec.interval === "day") cents += (line * 365) / 12 / perCount;
  }
  return Math.round(cents);
}

/** The customer's active subscription (for computing/applying the referrer
 *  reward), or null. Trialing subs count — they'll convert. */
async function activeSubscriptionFor(
  stripe: Stripe,
  customerId: string,
): Promise<Stripe.Subscription | null> {
  const res = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 10 });
  return res.data.find((s) => s.status === "active" || s.status === "trialing") ?? null;
}

/** Apply a customer-balance adjustment. "credit" reduces what they owe (negative
 *  balance = a credit toward the next invoice); "debit" claws it back. Idempotent
 *  via a per-event idempotency key. */
export async function applyBalanceMonth(args: {
  customerId: string;
  cents: number;
  direction: "credit" | "debit";
  eventId: string;
  reason: string;
}): Promise<void> {
  if (args.cents <= 0) return;
  const stripe = getStripe();
  const amount = args.direction === "credit" ? -Math.abs(args.cents) : Math.abs(args.cents);
  await stripe.customers.createBalanceTransaction(
    args.customerId,
    {
      amount, // negative = credit, positive = debit (clawback)
      currency: "usd",
      description: args.reason,
      metadata: { referral_event_id: args.eventId, direction: args.direction },
    },
    { idempotencyKey: `ref_${args.direction}_${args.eventId}` },
  );
}

/** Net referrer rewards granted in the trailing rolling window (grants minus
 *  reversals) — the cap denominator. */
export async function referrerNetRewardsInWindow(ownerCustomerId: string): Promise<number> {
  const admin = getSupabaseAdmin();
  const since = new Date(Date.now() - ROLLING_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await admin
    .from("referral_reward_ledger")
    .select("direction")
    .eq("owner_customer_id", ownerCustomerId)
    .gte("granted_at", since);
  let net = 0;
  for (const r of (data ?? []) as Array<{ direction: string }>) net += r.direction === "grant" ? 1 : -1;
  return net;
}

// ─────────────────────────── orchestration ───────────────────────────

interface ReferralEventRow {
  id: string;
  referral_code_id: string;
  referrer_customer_id: string;
  referee_pending_signup_id: string;
  referee_customer_id: string | null;
  status: string;
  referee_credit_applied_at: string | null;
  referrer_credit_applied_at: string | null;
}

/**
 * The referee's first successful (paid) invoice landed. Applies the referee's
 * give-a-month credit, the referrer's get-a-month reward (subject to the rolling
 * cap), and mints the referee's own code (propagation). Idempotent — safe under
 * webhook retries. `refereeKind` is the plan type the referee bought, used for
 * their propagated code.
 */
export async function onRefereePaidConversion(args: {
  refereePendingSignupId: string;
  refereeCustomerId: string;
  refereeKind: OwnerKind;
  invoiceId?: string;
  chargeId?: string;
  paymentIntentId?: string;
}): Promise<{
  status: "no_referral" | "self_referral_void" | "processed";
  refereeCredited?: boolean;
  referrerReward?: "granted" | "capped";
}> {
  const admin = getSupabaseAdmin();
  const stripe = getStripe();

  const { data: evData } = await admin
    .from("referral_events")
    .select(
      "id, referral_code_id, referrer_customer_id, referee_pending_signup_id, referee_customer_id, status, referee_credit_applied_at, referrer_credit_applied_at",
    )
    .eq("referee_pending_signup_id", args.refereePendingSignupId)
    .maybeSingle();
  const ev = evData as ReferralEventRow | null;
  if (!ev) return { status: "no_referral" };
  if (ev.status === "void") return { status: "self_referral_void" };

  // Self-referral guard.
  if (ev.referrer_customer_id === args.refereeCustomerId) {
    await admin.from("referral_events").update({ status: "void", updated_at: new Date().toISOString() }).eq("id", ev.id);
    return { status: "self_referral_void" };
  }

  // Persist conversion identity (needed for clawback matching) + mark converted.
  await admin
    .from("referral_events")
    .update({
      status: ev.status === "pending" ? "converted" : ev.status,
      referee_customer_id: args.refereeCustomerId,
      referee_invoice_id: args.invoiceId ?? null,
      referee_charge_id: args.chargeId ?? null,
      referee_payment_intent_id: args.paymentIntentId ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", ev.id);

  // 1) Referee give-a-month (once).
  let refereeCredited = false;
  if (!ev.referee_credit_applied_at) {
    const refereeSub = await activeSubscriptionFor(stripe, args.refereeCustomerId);
    const cents = refereeSub ? subscriptionMonthlyValueCents(refereeSub) : 0;
    if (cents > 0) {
      await applyBalanceMonth({ customerId: args.refereeCustomerId, cents, direction: "credit", eventId: ev.id, reason: "IGY referral: welcome month" });
      await admin.from("referral_events").update({ referee_credit_applied_at: new Date().toISOString() }).eq("id", ev.id);
      refereeCredited = true;
    }
  }

  // 2) Referrer get-a-month (once, subject to the rolling cap).
  let referrerReward: "granted" | "capped" | undefined;
  if (!ev.referrer_credit_applied_at) {
    const net = await referrerNetRewardsInWindow(ev.referrer_customer_id);
    if (net >= MAX_REFERRER_REWARDS_PER_YEAR) {
      referrerReward = "capped";
      await admin.from("referral_events").update({ status: "capped", updated_at: new Date().toISOString() }).eq("id", ev.id);
    } else {
      const referrerSub = await activeSubscriptionFor(stripe, ev.referrer_customer_id);
      const cents = referrerSub ? subscriptionMonthlyValueCents(referrerSub) : 0;
      if (cents > 0) {
        await applyBalanceMonth({ customerId: ev.referrer_customer_id, cents, direction: "credit", eventId: ev.id, reason: "IGY referral: reward month" });
        await admin.from("referral_reward_ledger").insert({ owner_customer_id: ev.referrer_customer_id, referral_event_id: ev.id, credit_cents: cents, direction: "grant" });
        await admin.from("referral_events").update({ status: "rewarded", referrer_credit_applied_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", ev.id);
        referrerReward = "granted";
      }
    }
  }

  // 3) Propagation — the referee now gets their own shareable code.
  await mintReferralCode(args.refereeCustomerId, args.refereeKind);

  return { status: "processed", refereeCredited, referrerReward };
}

/**
 * The referee's converting payment was refunded or charged back. Reverses the
 * referrer's granted reward (debits it back) and deactivates the referee's
 * propagated code so it can't drive further rewards. Idempotent. Matches the
 * event by the Stripe charge / payment-intent id stored at conversion.
 *
 * NOTE (open decision): this does NOT cascade to rewards the referee themselves
 * earned via their now-void code — deactivation is forward-only, per the plan's
 * default. Flip to cascade if directed.
 */
export async function onRefereePaymentReversed(args: {
  chargeId?: string;
  paymentIntentId?: string;
}): Promise<{ status: "no_match" | "already_reversed" | "reversed" }> {
  const admin = getSupabaseAdmin();

  let query = admin
    .from("referral_events")
    .select("id, referrer_customer_id, referee_customer_id, status, reversed_at")
    .in("status", ["rewarded", "converted"]);
  if (args.chargeId) query = query.eq("referee_charge_id", args.chargeId);
  else if (args.paymentIntentId) query = query.eq("referee_payment_intent_id", args.paymentIntentId);
  else return { status: "no_match" };

  const { data } = await query.maybeSingle();
  const ev = data as { id: string; referrer_customer_id: string; referee_customer_id: string | null; status: string; reversed_at: string | null } | null;
  if (!ev) return { status: "no_match" };
  if (ev.reversed_at) return { status: "already_reversed" };

  // Reverse the referrer reward if one was granted for this event.
  const { data: grant } = await admin
    .from("referral_reward_ledger")
    .select("credit_cents")
    .eq("referral_event_id", ev.id)
    .eq("direction", "grant")
    .maybeSingle();
  const grantCents = (grant as { credit_cents: number } | null)?.credit_cents ?? 0;
  if (grantCents > 0) {
    await applyBalanceMonth({ customerId: ev.referrer_customer_id, cents: grantCents, direction: "debit", eventId: ev.id, reason: "IGY referral: clawback (referee payment reversed)" });
    await admin.from("referral_reward_ledger").insert({ owner_customer_id: ev.referrer_customer_id, referral_event_id: ev.id, credit_cents: grantCents, direction: "reversal" });
  }

  // Deactivate the referee's propagated code.
  if (ev.referee_customer_id) {
    await admin.from("referral_codes").update({ active: false }).eq("owner_customer_id", ev.referee_customer_id);
  }

  await admin.from("referral_events").update({ status: "void", reversed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", ev.id);
  return { status: "reversed" };
}
