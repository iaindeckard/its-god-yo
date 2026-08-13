import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { onRefereePaidConversion, onRefereePaymentReversed, ownerKindForPlan } from "@/lib/referral";
import { markConvertedByPromotionCodeId } from "@/lib/outreach/leads";
import { upsertSubscriptionPayment, tsIso, type PaymentCapture } from "@/lib/subscriptionPayments";
import { cancelSubscriptionForSignup, cancelStripeSubscriptionById } from "@/lib/cancelSubscription";
import { sendOpsAlert } from "@/lib/opsAlert";
import { recordActionItem, resolveOpenByDedupe } from "@/lib/actionItems";

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
 * (off-session SCA at trial end), subscription updated/deleted, charge.refunded,
 * charge.dispute.created, charge.dispute.closed.
 *
 * Referral hooks: on the referee's FIRST real charge (invoice.paid with
 * amount_paid > 0 AND billing_reason 'subscription_cycle' — NOT the $0
 * trial-start invoice, whose billing_reason is 'subscription_create') we fire
 * onRefereePaidConversion (give/get a month + propagation); on charge.refunded /
 * charge.dispute.created we fire onRefereePaymentReversed (clawback). Both no-op
 * when the payment isn't tied to a referral, and are idempotent under retries.
 *
 * Disputes vs refunds: a chargeback is NOT a voluntary refund. charge.dispute.created
 * CANCELS the subscription (the customer repudiated the charge) to the same
 * 'canceled' end-state a refund reaches, but tags it as a chargeback (distinct
 * cancel reason + a kind='dispute' ledger row, never aliased into a refund) and
 * emails ops. charge.dispute.closed with a WON outcome does NOT auto-reinstate the
 * subscription (reinstatement has real re-billing implications) — it flags a human
 * for review instead. The won-back settlement lands on the ledger via the reconcile
 * cron, not here.
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

  // Fire referral conversion for the referee's first REAL charge. No-ops when the
  // signup wasn't referred. Resolves pending_signup_id + plan from the
  // pending_signups row (already keyed by stripe_subscription_id).
  // Church-outreach conversion (spec §5). An outreach church signs up through the
  // normal flow, so its pending_signups row already carries the outreach promo's
  // promotion_code id. On the referee's first REAL charge we match that id to an
  // igy_outreach_leads row and mark it converted. Independent of and additive to
  // the referral path — no-ops when the signup used no outreach code, idempotent
  // (markConverted only moves a not-yet-converted row).
  const handleOutreachConversion = async (inv: Stripe.Invoice) => {
    const subId = invSubId(inv);
    if (!subId) return;
    const { data: ps } = await admin
      .from("pending_signups")
      .select("promo_promotion_code_id")
      .eq("stripe_subscription_id", subId)
      .maybeSingle();
    const pcId = (ps as { promo_promotion_code_id?: string | null } | null)?.promo_promotion_code_id;
    if (!pcId) return;
    const amountPaid = (inv as unknown as { amount_paid?: number }).amount_paid ?? null;
    await markConvertedByPromotionCodeId(pcId, amountPaid);
  };

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
  // The row shape, tsIso, and the idempotent upsert now live in
  // lib/subscriptionPayments so this webhook and the reconcile cron produce
  // byte-identical rows and share idempotency (unique on balance_transaction_id).
  // safeCapture (below) still wraps every call so a ledger failure can never break
  // the status-update / referral-clawback logic; durability is via the reconcile
  // backfill, not a webhook 500/retry. recordPayment returns { inserted } (ignored
  // here — the reconcile job uses it to count gaps).
  const recordPayment = (p: PaymentCapture) => upsertSubscriptionPayment(admin, p);

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

  // Ops-alert wrapper: high-signal notifications (a chargeback opened / won) must
  // never break the handler if Resend is down, so failures are logged, not thrown.
  const safeAlert = async (label: string, args: { subject: string; text: string }) => {
    try {
      await sendOpsAlert(args);
    } catch (e) {
      console.error(`[stripe-webhook] ops alert failed (${label}):`, e);
    }
  };

  // A dispute carries a charge, not a subscription. Resolve the subscription the
  // disputed charge belongs to via its invoice (charge -> invoice -> subscription).
  // Returns null if it can't be tied to a subscription (e.g. a one-off charge).
  const resolveSubIdForDispute = async (dispute: Stripe.Dispute): Promise<string | null> => {
    const chargeId = idOf((dispute as unknown as { charge?: unknown }).charge);
    if (!chargeId) return null;
    try {
      const ch = await stripe.charges.retrieve(chargeId, { expand: ["invoice"] });
      const inv = (ch as unknown as { invoice?: Stripe.Invoice | string | null }).invoice;
      if (!inv) return null;
      const full = typeof inv === "string" ? await stripe.invoices.retrieve(inv) : inv;
      return invSubId(full);
    } catch (e) {
      console.error(`[stripe-webhook] could not resolve subscription for dispute=${dispute.id}:`, e);
      return null;
    }
  };

  // Cancel the subscription a disputed charge belongs to, to the same 'canceled'
  // end-state a refund reaches — but tagged as a CHARGEBACK, never aliased into a
  // refund. Uses the local signup's cancel path when we have one (cancels Stripe +
  // flips pending_signups.status), else cancels the Stripe sub directly so billing
  // still stops. Main-path (not swallowed): a failure -> 500 -> Stripe retries;
  // every step is idempotent. Returns the resolved subscription id for logging.
  const cancelSubscriptionForChargeback = async (dispute: Stripe.Dispute): Promise<string | null> => {
    const subId = await resolveSubIdForDispute(dispute);
    const reason = `chargeback:dispute:${dispute.id}`;
    if (!subId) {
      console.warn(`[stripe-webhook][ALERT] chargeback dispute=${dispute.id} — could not resolve a subscription to cancel; MANUAL REVIEW.`);
      return null;
    }
    const { data: ps } = await admin.from("pending_signups").select("id").eq("stripe_subscription_id", subId).maybeSingle();
    if (ps?.id) {
      await cancelSubscriptionForSignup(ps.id, reason);
    } else {
      await cancelStripeSubscriptionById(subId, reason);
      console.warn(`[stripe-webhook][ALERT] chargeback canceled sub=${subId} with no pending_signups row (dispute=${dispute.id}).`);
    }
    return subId;
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
      livemode: ch.livemode,
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
    // The Charge in a charge.refunded event does NOT carry an expanded `refunds` list
    // in current API versions (refunds must be expanded/fetched), so reading
    // charge.refunds.data would loop over nothing and capture zero refunds. List them
    // explicitly. The reconcile cron is still the durability backstop, but this keeps
    // live refund capture working. Idempotent on balance_transaction_id either way.
    const refunds: Stripe.Refund[] = [];
    for await (const r of stripe.refunds.list({ charge: charge.id, limit: 100 })) refunds.push(r);
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
        livemode: charge.livemode,
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
        livemode: dispute.livemode,
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
        const paidSubId = invSubId(inv);
        await setStatusBySub(paidSubId, "active");
        // Dunning recovered: clear any open failed-billing item for this sub.
        if (paidSubId) await resolveOpenByDedupe(`failed_billing:${paidSubId}`);
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
          await handleOutreachConversion(inv);
        }
        break;
      }
      case "invoice.payment_failed": {
        const inv = event.data.object as Stripe.Invoice;
        const subId = invSubId(inv);
        await setStatusBySub(subId, "past_due");
        // Persist a failed-billing action item (deduped per subscription) so a real
        // dunning failure surfaces on the admin landing page, not just in logs.
        if (subId) {
          const { data: ps } = await admin
            .from("pending_signups")
            .select("id, purchaser_email")
            .eq("stripe_subscription_id", subId)
            .maybeSingle();
          const amountDue = (inv as unknown as { amount_due?: number }).amount_due ?? null;
          const attempt = (inv as unknown as { attempt_count?: number }).attempt_count ?? null;
          const email = (ps as { purchaser_email?: string } | null)?.purchaser_email ?? "unknown";
          await recordActionItem({
            kind: "failed_billing",
            dedupeKey: `failed_billing:${subId}`,
            title: `Payment failed — ${email}`,
            detail: `Invoice ${inv.id ?? "?"} failed${attempt ? ` (attempt ${attempt})` : ""}. Subscription is past_due; dunning will retry. Resolve once recovered or the customer is contacted.`,
            pendingSignupId: (ps as { id?: string } | null)?.id ?? null,
            stripeCustomerId: idOf((inv as unknown as { customer?: unknown }).customer),
            stripeSubscriptionId: subId,
            amountCents: amountDue,
            currency: (inv as unknown as { currency?: string }).currency ?? null,
          });
        }
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
        // Referral clawback (same action as a refund — a rewarded conversion was
        // reversed, whichever way the money went back).
        await onRefereePaymentReversed({
          chargeId: idOf((dispute as unknown as { charge?: unknown }).charge) ?? undefined,
          paymentIntentId: idOf((dispute as unknown as { payment_intent?: unknown }).payment_intent) ?? undefined,
        });
        // A chargeback means the customer repudiated the charge: CANCEL the sub to
        // the same end-state a refund reaches, tagged as a chargeback (distinct
        // reason). Main path — a failure returns 500 and Stripe retries.
        const disputedSubId = await cancelSubscriptionForChargeback(dispute);
        // Ledger: record the dispute's own (negative) balance transaction(s) as a
        // kind='dispute' row — NEVER a kind='refund' row. Best-effort/decoupled.
        await safeCapture("charge.dispute.created", () => captureDispute(dispute));
        // Notify: a chargeback is a fraud/dispute signal AND an auto-cancellation.
        await safeAlert("chargeback-created", {
          subject: "Chargeback received — subscription auto-canceled",
          text:
            `A chargeback (dispute) was opened, so the subscription was automatically canceled ` +
            `(same end-state as a refund) and tagged as a chargeback in the ledger.\n\n` +
            `Dispute: ${dispute.id}\n` +
            `Charge: ${idOf((dispute as unknown as { charge?: unknown }).charge) ?? "unknown"}\n` +
            `Amount: ${(dispute.amount ?? 0) / 100} ${String(dispute.currency ?? "").toUpperCase()}\n` +
            `Reason: ${dispute.reason ?? "unknown"}\n` +
            `Subscription: ${disputedSubId ?? "could not resolve — manual review"}\n\n` +
            `If this dispute later closes in our favor you will get a separate manual-review alert. ` +
            `Reinstatement is NOT automatic.`,
        });
        break;
      }
      case "charge.dispute.closed": {
        const dispute = event.data.object as Stripe.Dispute;
        const outcome = (dispute as unknown as { status?: string }).status ?? "unknown";
        const subId = await resolveSubIdForDispute(dispute);
        if (outcome === "won") {
          // We won the dispute. Do NOT auto-reinstate: reinstating a canceled sub
          // has real billing implications (re-bill? from when?). Flag a human.
          console.warn(`[stripe-webhook][ALERT] dispute WON dispute=${dispute.id} sub=${subId ?? "?"} — subscription stays CANCELED; manual review for any reinstatement.`);
          await safeAlert("dispute-won-review", {
            subject: "Dispute WON — manual review (do NOT auto-reinstate)",
            text:
              `We won a dispute. The subscription was canceled when the dispute opened and was NOT ` +
              `automatically reinstated (reinstating has re-billing implications).\n\n` +
              `Dispute: ${dispute.id}\n` +
              `Charge: ${idOf((dispute as unknown as { charge?: unknown }).charge) ?? "unknown"}\n` +
              `Amount: ${(dispute.amount ?? 0) / 100} ${String(dispute.currency ?? "").toUpperCase()}\n` +
              `Subscription: ${subId ?? "could not resolve"}\n\n` +
              `Decide manually whether to re-subscribe this customer and from what date. ` +
              `The won-back funds settle back onto the ledger via the reconcile cron.`,
          });
          // Persist a dispute-review action item (deduped per dispute) so the
          // manual reinstatement decision is tracked on the landing page, not just
          // emailed once.
          await recordActionItem({
            kind: "dispute_review",
            dedupeKey: `dispute_review:${dispute.id}`,
            title: `Dispute won — reinstatement decision`,
            detail: `We won dispute ${dispute.id}. The subscription (${subId ?? "unresolved"}) was canceled when the dispute opened and was NOT auto-reinstated. Decide whether to re-subscribe and from what date, then resolve.`,
            stripeDisputeId: dispute.id,
            stripeChargeId: idOf((dispute as unknown as { charge?: unknown }).charge),
            stripeSubscriptionId: subId,
            amountCents: dispute.amount ?? null,
            currency: String(dispute.currency ?? "") || null,
          });
        } else {
          // lost / warning_closed / other: the chargeback stands; sub already canceled.
          console.log(`[stripe-webhook] dispute closed status=${outcome} dispute=${dispute.id} sub=${subId ?? "?"} — no reinstatement (sub already canceled).`);
        }
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
