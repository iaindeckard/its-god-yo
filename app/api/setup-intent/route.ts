import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { PURCHASES_ENABLED, PREORDER_MODE } from "@/lib/flags";

/**
 * Creates a Stripe Customer + SetupIntent so the browser can save a card WITHOUT
 * charging it. `usage: "off_session"` is required because the real subscription
 * is charged later (after SMS confirmation), when the purchaser is not present.
 * Returns the client_secret (for the Payment Element) plus customer_id /
 * setup_intent_id, which the client threads back into submit-consent.
 */
export async function POST(req: Request) {
  // Hard block unless purchases are live OR we're in preorder (reserve) mode.
  // A SetupIntent only SAVES a card (usage:"off_session") — it never charges — so
  // allowing it in preorder mode carries no billing risk (see lib/flags.ts).
  if (!PURCHASES_ENABLED && !PREORDER_MODE) {
    return NextResponse.json({ error: "coming_soon", message: "Signups aren't open yet." }, { status: 503 });
  }
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
