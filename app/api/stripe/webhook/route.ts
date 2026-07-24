import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

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

  try {
    switch (event.type) {
      case "customer.subscription.trial_will_end": {
        const sub = event.data.object as Stripe.Subscription;
        console.log(`[stripe-webhook] trial_will_end sub=${sub.id} (reminder window)`);
        break;
      }
      case "invoice.paid": {
        await setStatusBySub(invSubId(event.data.object as Stripe.Invoice), "active");
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
      default:
        // Acknowledge unhandled event types without error.
        break;
    }
  } catch (e) {
    console.error(`[stripe-webhook] handler error for ${event.type}:`, e);
  }

  return NextResponse.json({ received: true, type: event.type });
}
