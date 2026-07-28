import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { onRefereePaidConversion, onRefereePaymentReversed, type OwnerKind } from "@/lib/referral";

export const dynamic = "force-dynamic";

/**
 * Stripe webhook for the deferred-trial subscription model. Signature is
 * verified against STRIPE_WEBHOOK_SECRET (this is the security boundary — the
 * endpoint is public). We reflect the subscription lifecycle onto the
 * pending_signups row (matched by stripe_subscription_id) and always return 200
 * on handled events so Stripe doesn't retry our internal hiccups.
 *
 * Handled: trial_will_end (reminder window), invoice.paid (first real charge /
 * renewal), invoice.payment_failed (dunning), invoice.payment_action_required
 * (off-session SCA at trial end), subscription updated/deleted.
 *
 * Referral hooks: on the referee's FIRST real charge (invoice.paid with
 * amount_paid > 0 AND billing_reason 'subscription_cycle' — NOT the $0
 * trial-start invoice, whose billing_reason is 'subscription_create') we fire
 * onRefereePaidConversion (give/get a month + propagation); on charge.refunded /
 * charge.dispute.created we fire onRefereePaymentReversed (clawback). Both no-op
 * when the payment isn't tied to a referral, and are idempotent under retries.
 */
export async function POST(req: Request) {
  const stripe = getStripe();
  const sig = req.headers.get("stripe-signature");
  // Trim defensively: a signing secret pasted into an env var with a trailing
  // newline/space fails constructEvent for every event, which looks exactly like
  // a "wrong secret" (HTTP 400 on all deliveries).
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!sig || !secret) return NextResponse.json({ error: "missing_signature_or_secret" }, { status: 400 });

  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch (e) {
    // Log (without the secret) so signature failures are visible in Vercel logs —
    // the 400 path was previously silent, making this class of failure hard to confirm.
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[stripe-webhook] signature verification failed (secret len=${secret.length}): ${msg}`);
    return NextResponse.json({ error: `signature_verification_failed: ${msg}` }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const setStatusBySub = async (subscriptionId: string | null, status: string) => {
    if (!subscriptionId) return;
    let q = admin.from("pending_signups").update({ status }).eq("stripe_subscription_id", subscriptionId);
    // `canceled` is absorbing for a given subscription id — Stripe never un-cancels
    // a sub (reactivation mints a new id). Guard against a delayed or duplicate
    // retry of an earlier lifecycle event (e.g. invoice.paid -> "active") stomping a
    // canceled row back to a live status. Setting canceled itself stays unguarded.
    if (status !== "canceled") q = q.neq("status", "canceled");
    await q;
  };
  const invSubId = (inv: Stripe.Invoice): string | null => {
    const s = (inv as unknown as { subscription?: string | { id: string } | null }).subscription;
    return typeof s === "string" ? s : s?.id ?? null;
  };
  const idOf = (v: unknown): string | null =>
    typeof v === "string" ? v : (v as { id?: string } | null)?.id ?? null;
  // Group buyers are churches; everyone else is a family. Cosmetic label on the
  // referee's propagated code — the balance-credit reward scales regardless.
  const ownerKindForPlan = (planKey: string | null | undefined): OwnerKind =>
    typeof planKey === "string" && planKey.startsWith("group") ? "church" : "family";

  // Fire referral conversion for the referee's first REAL charge. No-ops when the
  // signup wasn't referred. Resolves pending_signup_id + plan from the
  // pending_signups row (already keyed by stripe_subscription_id).
  const handleReferralConversion = async (inv: Stripe.Invoice) => {
    const subId = invSubId(inv);
    if (!subId) return;
    const { data: ps } = await admin
      .from("pending_signups")
      .select("id, plan_key")
      .eq("stripe_subscription_id", subId)
      .maybeSingle();
    if (!ps?.id) return;
    const customerId = idOf((inv as unknown as { customer?: unknown }).customer);
    if (!customerId) return;
    await onRefereePaidConversion({
      refereePendingSignupId: ps.id,
      refereeCustomerId: customerId,
      refereeKind: ownerKindForPlan(ps.plan_key),
      invoiceId: inv.id ?? undefined,
      chargeId: idOf((inv as unknown as { charge?: unknown }).charge) ?? undefined,
      paymentIntentId: idOf((inv as unknown as { payment_intent?: unknown }).payment_intent) ?? undefined,
    });
  };

  // ── subscription_payments capture (launch blocker + multi-currency) ──────────
  // Row-level realized-charge ledger mirroring USN's sponsor_payments. Every
  // settled charge/refund/dispute lands as ONE row keyed by its Stripe balance
  // transaction id (idempotent under retries). Captures BOTH presentment
  // (original_*) and the Stripe-SETTLED figure (settled_*): expanding the charge's
  // balance_transaction is what surfaces the settled USD + exchange_rate that
  // invoice.amount_paid alone does not carry. Currency-agnostic — identical path
  // for usd/cad/gbp/eur. See IGY-DEI-Rollup-Multi-Currency-Architecture-v3.
  const tsIso = (unix: number | null | undefined): string | null =>
    typeof unix === "number" ? new Date(unix * 1000).toISOString() : null;

  type CaptureInput = {
    kind: "charge" | "refund" | "dispute";
    bt: Stripe.BalanceTransaction | null;
    originalAmountCents: number | null;
    originalCurrency: string | null;
    chargeId: string | null;
    invoiceId: string | null;
    paymentIntentId: string | null;
    subscriptionId: string | null;
    customerId: string | null;
    billingReason: string | null;
    status: string;
    periodStart: string | null;
    periodEnd: string | null;
  };
  const recordPayment = async (p: CaptureInput) => {
    const bt = p.bt;
    if (!bt?.id) {
      // No settlement record → nothing canonical to store. Log and let Stripe
      // redeliver; a later reconciliation can backfill. Never write a settled-less
      // row (the rollup would read it as unverified anyway).
      console.warn(`[stripe-webhook] payment capture: no balance_transaction for ${p.kind} charge=${p.chargeId ?? "?"} — skipped`);
      return;
    }
    const { error } = await admin.from("subscription_payments").upsert(
      {
        business_unit: "igy",
        kind: p.kind,
        balance_transaction_id: bt.id,
        stripe_charge_id: p.chargeId,
        stripe_invoice_id: p.invoiceId,
        stripe_payment_intent_id: p.paymentIntentId,
        stripe_subscription_id: p.subscriptionId,
        stripe_customer_id: p.customerId,
        original_amount_cents: p.originalAmountCents,
        original_currency: p.originalCurrency,
        settled_amount_cents: bt.amount ?? null,
        settled_currency: bt.currency ?? null,
        settled_fee_cents: bt.fee ?? null,
        settled_net_cents: bt.net ?? null,
        exchange_rate: bt.exchange_rate ?? null,
        billing_reason: p.billingReason,
        status: p.status,
        period_start: p.periodStart,
        period_end: p.periodEnd,
        stripe_created_at: tsIso(bt.created),
      },
      { onConflict: "balance_transaction_id", ignoreDuplicates: true },
    );
    if (error) throw error; // caught by safeCapture at the call site — never breaks the handler; durability is via backfill, not a webhook 500/retry
  };

  // Ledger capture is ADDITIVE and best-effort: it must NEVER break the existing
  // status-update / referral-clawback logic that shares these event cases. Any
  // failure here (bad column, schema drift, transient Stripe/DB error) is logged
  // at error level and swallowed — the row is simply not captured on this delivery
  // (idempotent + backfillable), and the handler proceeds to its normal 200 exactly
  // as before. This deliberately decouples ledger durability from the live webhook
  // path: a ledger bug can lose/delay a row, but can't regress status or referrals.
  const safeCapture = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      console.error(`[stripe-webhook] subscription_payments capture failed (${label}) — swallowed to protect handler:`, e);
    }
  };

  // invoice.paid → the realized recurring charge. Expand its charge to the
  // balance_transaction for the settled figure. Skips $0 invoices (no charge,
  // e.g. trial-start) since nothing settled. Captures ALL real charges
  // (subscription_create + subscription_cycle), broader than the referral gating.
  const capturePaidInvoice = async (inv: Stripe.Invoice) => {
    const chargeId = idOf((inv as unknown as { charge?: unknown }).charge);
    if (!chargeId) return;
    const ch = await stripe.charges.retrieve(chargeId, { expand: ["balance_transaction"] });
    const bt = (ch.balance_transaction ?? null) as Stripe.BalanceTransaction | null;
    await recordPayment({
      kind: "charge",
      bt,
      originalAmountCents: ch.amount ?? null,
      originalCurrency: ch.currency ?? null,
      chargeId: ch.id,
      invoiceId: inv.id ?? null,
      paymentIntentId: idOf((ch as unknown as { payment_intent?: unknown }).payment_intent),
      subscriptionId: invSubId(inv),
      customerId: idOf((inv as unknown as { customer?: unknown }).customer),
      billingReason: (inv as unknown as { billing_reason?: string }).billing_reason ?? null,
      status: "paid",
      periodStart: tsIso((inv as unknown as { period_start?: number }).period_start),
      periodEnd: tsIso((inv as unknown as { period_end?: number }).period_end),
    });
  };

  // charge.refunded → each refund settles as its OWN balance transaction at its OWN
  // rate (negative amount). Record each so net = SUM(settled_amount_cents); never
  // derive a refund by subtracting the original presentment amount.
  const captureRefunds = async (charge: Stripe.Charge) => {
    const refunds = (charge.refunds as unknown as { data?: Stripe.Refund[] } | null)?.data ?? [];
    const customerId = idOf((charge as unknown as { customer?: unknown }).customer);
    const invoiceId = idOf((charge as unknown as { invoice?: unknown }).invoice);
    const piId = idOf((charge as unknown as { payment_intent?: unknown }).payment_intent);
    for (const r of refunds) {
      const btId = idOf((r as unknown as { balance_transaction?: unknown }).balance_transaction);
      if (!btId) continue;
      const bt = await stripe.balanceTransactions.retrieve(btId);
      await recordPayment({
        kind: "refund",
        bt,
        originalAmountCents: typeof r.amount === "number" ? -r.amount : null, // signed to match settled
        originalCurrency: r.currency ?? charge.currency ?? null,
        chargeId: charge.id,
        invoiceId,
        paymentIntentId: piId,
        subscriptionId: null, // not carried on the charge; ch/invoice ids tie it back
        customerId,
        billingReason: null,
        status: "refunded",
        periodStart: null,
        periodEnd: null,
      });
    }
  };

  // charge.dispute.created → the dispute withdrawal(s) already carry their balance
  // transactions in the event payload (negative). Record each.
  const captureDispute = async (dispute: Stripe.Dispute) => {
    const bts = (dispute as unknown as { balance_transactions?: Stripe.BalanceTransaction[] }).balance_transactions ?? [];
    const chargeId = idOf((dispute as unknown as { charge?: unknown }).charge);
    const piId = idOf((dispute as unknown as { payment_intent?: unknown }).payment_intent);
    for (const bt of bts) {
      await recordPayment({
        kind: "dispute",
        bt,
        originalAmountCents: null,
        originalCurrency: bt.currency ?? null,
        chargeId,
        invoiceId: null,
        paymentIntentId: piId,
        subscriptionId: null,
        customerId: null,
        billingReason: null,
        status: "dispute",
        periodStart: null,
        periodEnd: null,
      });
    }
  };

  try {
    switch (event.type) {
      case "customer.subscription.trial_will_end": {
        const sub = event.data.object as Stripe.Subscription;
        console.log(`[stripe-webhook] trial_will_end sub=${sub.id} (reminder window)`);
        break;
      }
      case "invoice.paid": {
        const inv = event.data.object as Stripe.Invoice;
        await setStatusBySub(invSubId(inv), "active");
        // Row-level realized-charge ledger (launch blocker + settled-currency
        // capture). Runs for every real charge, independent of referral gating.
        await safeCapture("invoice.paid", () => capturePaidInvoice(inv));
        // Reward on PAID conversion, not signup: only the first real charge —
        // amount_paid > 0 AND billing_reason 'subscription_cycle' — never the $0
        // trial-start invoice (billing_reason 'subscription_create').
        const amountPaid = (inv as unknown as { amount_paid?: number }).amount_paid ?? 0;
        const billingReason = (inv as unknown as { billing_reason?: string }).billing_reason;
        if (amountPaid > 0 && billingReason === "subscription_cycle") {
          await handleReferralConversion(inv);
        }
        break;
      }
      case "invoice.payment_failed": {
        await setStatusBySub(invSubId(event.data.object as Stripe.Invoice), "past_due");
        break;
      }
      case "invoice.payment_action_required": {
        await setStatusBySub(invSubId(event.data.object as Stripe.Invoice), "requires_action");
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        await setStatusBySub(sub.id, "canceled");
        break;
      }
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        console.log(`[stripe-webhook] subscription.updated sub=${sub.id} status=${sub.status}`);
        break;
      }
      case "charge.refunded": {
        // Referral clawback: reverse the referrer's reward + deactivate the
        // referee's propagated code if this charge backed a rewarded conversion.
        const charge = event.data.object as Stripe.Charge;
        await onRefereePaymentReversed({
          chargeId: charge.id,
          paymentIntentId: idOf((charge as unknown as { payment_intent?: unknown }).payment_intent) ?? undefined,
        });
        // Ledger: record the refund's own (negative) balance transaction so net
        // realized revenue stays correct without subtracting presentment amounts.
        await safeCapture("charge.refunded", () => captureRefunds(charge));
        break;
      }
      case "charge.dispute.created": {
        const dispute = event.data.object as Stripe.Dispute;
        await onRefereePaymentReversed({
          chargeId: idOf((dispute as unknown as { charge?: unknown }).charge) ?? undefined,
          paymentIntentId: idOf((dispute as unknown as { payment_intent?: unknown }).payment_intent) ?? undefined,
        });
        // Ledger: record the dispute's own (negative) balance transaction(s).
        await safeCapture("charge.dispute.created", () => captureDispute(dispute));
        break;
      }
      default:
        // Acknowledge unhandled event types without error.
        break;
    }
  } catch (e) {
    // Surface failures as 500 so Stripe retries with backoff, instead of swallowing
    // them into a 200 (the old behavior silently dropped work — e.g. a referral
    // idempotency-key collision that left a referrer un-rewarded with no retry).
    // Safe because every write here is idempotent under retry: pending_signups
    // status writes are guarded + CHECK-valid, referral balance credits use
    // per-(event,direction,customer) Stripe idempotency keys, and ledger rows upsert
    // against a unique (referral_event_id, direction) index. Stripe stops retrying
    // after ~3 days and flags the endpoint, so a persistent failure surfaces.
    console.error(`[stripe-webhook] handler error for ${event.type}:`, e);
    return NextResponse.json({ error: "handler_error", type: event.type }, { status: 500 });
  }

  return NextResponse.json({ received: true, type: event.type });
}
