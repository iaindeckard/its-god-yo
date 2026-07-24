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
    await admin.from("pending_signups").update({ status }).eq("stripe_subscription_id", subscriptionId);
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
        break;
      }
      case "charge.dispute.created": {
        const dispute = event.data.object as Stripe.Dispute;
        await onRefereePaymentReversed({
          chargeId: idOf((dispute as unknown as { charge?: unknown }).charge) ?? undefined,
          paymentIntentId: idOf((dispute as unknown as { payment_intent?: unknown }).payment_intent) ?? undefined,
        });
        break;
      }
      default:
        // Acknowledge unhandled event types without error.
        break;
    }
  } catch (e) {
    console.error(`[stripe-webhook] handler error for ${event.type}:`, e);
  }

  return NextResponse.json({ received: true, type: event.type });
}
