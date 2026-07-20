import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";

/**
 * Creates a Stripe Customer + SetupIntent so the browser can save a card WITHOUT
 * charging it. `usage: "off_session"` is required because the real subscription
 * is charged later (after SMS confirmation), when the purchaser is not present.
 * Returns the client_secret (for the Payment Element) plus customer_id /
 * setup_intent_id, which the client threads back into submit-consent.
 */
export async function POST(req: Request) {
  let body: { email?: string; language?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body is fine */
  }

  try {
    const stripe = getStripe();
    const customer = await stripe.customers.create({
      email: body.email?.trim() || undefined,
      metadata: { source: "itsgodyo_web_signup", language: body.language ?? "" },
    });
    const setupIntent = await stripe.setupIntents.create({
      customer: customer.id,
      usage: "off_session",
      payment_method_types: ["card"],
      metadata: { source: "itsgodyo_web_signup" },
    });
    return NextResponse.json({
      client_secret: setupIntent.client_secret,
      customer_id: customer.id,
      setup_intent_id: setupIntent.id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "stripe_error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
