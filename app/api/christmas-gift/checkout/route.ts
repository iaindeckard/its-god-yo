import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadChristmasConfig, resolveWindow, validateReleaseDate } from "@/lib/christmasGift";
import { findUsableReferralCode, recordChristmasGiftReferral } from "@/lib/referral";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Christmas Scheduled Gift 2026 — checkout. Charges a one-time PaymentIntent NOW
 * (no SetupIntent, no Stripe subscription). The amount is computed SERVER-SIDE from
 * the active pricing window in christmas_gift_2026_config; the client cannot choose
 * or influence the price. Fails closed on any config/window/date problem.
 *
 * Flow (robust against SCA / tab-close): create the purchase row in 'pending_payment',
 * create the PaymentIntent, return its client_secret for the Payment Element. The row
 * only advances to 'awaiting_release' when the Stripe webhook confirms the charge
 * settled (payment_intent.succeeded) — so an abandoned or failed payment never leaves
 * a row the release cron would text a recipient about.
 */
interface CheckoutBody {
  purchaser_email?: string;
  purchaser_first_name?: string;
  purchaser_last_name?: string;
  purchaser_salutation?: string[];
  gifter_first_name?: string;
  gifter_last_name?: string;
  gifter_honorific?: string;
  gifter_relationship?: string;
  recipient_first_name?: string;
  recipient_phone?: string;
  language?: string;
  recipient_birth_year?: number;
  recipient_country_code?: string;
  release_at?: string;
  referral_code?: string;
}

const bad = (reason: string, status = 400) => NextResponse.json({ ok: false, error: reason }, { status });

export async function POST(req: Request) {
  let body: CheckoutBody;
  try {
    body = (await req.json()) as CheckoutBody;
  } catch {
    return bad("invalid_json");
  }

  const email = body.purchaser_email?.trim();
  const phone = body.recipient_phone?.trim();
  const language = body.language === "es" ? "es" : body.language === "en" ? "en" : null;
  if (!email) return bad("purchaser_email_required");
  if (!phone) return bad("recipient_phone_required");
  if (!language) return bad("language_required");

  // Recipient birth year is REQUIRED and validated server-side (a client "required"
  // attribute is not a guarantee). The release-day age gate needs it; fail closed here
  // so a purchase can never be created without a usable birth year, consistent with the
  // rest of this feature. Sanity range only; the actual age/consent decision is the gate.
  const birthYear = body.recipient_birth_year;
  if (typeof birthYear !== "number" || !Number.isInteger(birthYear)) return bad("recipient_birth_year_required");
  const nowYear = new Date().getUTCFullYear();
  if (birthYear < 1900 || birthYear > nowYear) return bad("recipient_birth_year_invalid");

  const admin = getSupabaseAdmin();
  const nowMs = Date.now();

  // Load config + resolve window/price/date, all fail-closed.
  const cfg = await loadChristmasConfig(admin);
  const win = resolveWindow(cfg, nowMs);
  if (!win.ok) return bad(win.reason);
  const rel = validateReleaseDate(body.release_at, cfg!, nowMs);
  if (!rel.ok) return bad(rel.reason);

  const stripe = getStripe();

  // 1) Insert the purchase row first (pending_payment) so we have a stable id to use
  //    as the PaymentIntent idempotency key and metadata link.
  const insertRow = {
    purchaser_email: email,
    purchaser_first_name: body.purchaser_first_name ?? null,
    purchaser_last_name: body.purchaser_last_name ?? null,
    purchaser_salutation: Array.isArray(body.purchaser_salutation) ? body.purchaser_salutation : null,
    gifter_first_name: body.gifter_first_name ?? null,
    gifter_last_name: body.gifter_last_name ?? null,
    gifter_honorific: body.gifter_honorific ?? null,
    gifter_relationship: body.gifter_relationship ?? null,
    recipient_first_name: body.recipient_first_name ?? null,
    recipient_phone: phone,
    language,
    recipient_birth_year: birthYear,
    recipient_country_code: body.recipient_country_code ?? null,
    list_price_cents: win.listCents,
    charged_amount_cents: win.chargedCents,
    purchase_window: win.window,
    dmfh_bonus_included: win.dmfhBonus,
    release_at: rel.releaseDate,
    referral_code: body.referral_code?.trim() || null,
    status: "pending_payment",
    // stripe_customer_id / stripe_payment_intent_id are NOT NULL; set immediately
    // after we create them below (the row is written in two steps within this request).
    stripe_customer_id: "",
    stripe_payment_intent_id: "",
  };

  const { data: created, error: insErr } = await admin
    .from("christmas_gift_2026_purchases")
    .insert(insertRow)
    .select("id")
    .single();
  if (insErr || !created) {
    console.error("[christmas-checkout] purchase insert failed:", insErr);
    return bad("purchase_create_failed", 500);
  }
  const purchaseId = (created as { id: string }).id;

  try {
    // 2) Customer for this purchase (also the target for a non-confirmation account credit).
    //    Reuse an existing Stripe customer for this email so a repeat buyer's purchases
    //    stay under ONE customer record; only create a new one if none exists.
    const name = [body.purchaser_first_name, body.purchaser_last_name].filter(Boolean).join(" ") || undefined;
    const existing = await stripe.customers.list({ email, limit: 1 });
    const customer =
      existing.data[0] ??
      (await stripe.customers.create({ email, name, metadata: { source: "christmas_gift_2026" } }));

    // 3) One-time charge. NO subscription, NO SetupIntent. Metadata tags drive the
    //    webhook capture + revenue reporting.
    const pi = await stripe.paymentIntents.create(
      {
        amount: win.chargedCents,
        currency: "usd",
        customer: customer.id,
        payment_method_types: ["card"],
        description: "It's God, Yo! - Christmas gift subscription (prepaid one year)",
        metadata: {
          purpose: "christmas_gift_2026",
          christmas_purchase_id: purchaseId,
          purchase_window: win.window,
          dmfh_bonus: String(win.dmfhBonus),
        },
      },
      { idempotencyKey: `igy_xmas_${purchaseId}` },
    );

    // 4) Backfill the Stripe ids onto the row.
    const { error: updErr } = await admin
      .from("christmas_gift_2026_purchases")
      .update({ stripe_customer_id: customer.id, stripe_payment_intent_id: pi.id, updated_at: new Date().toISOString() })
      .eq("id", purchaseId);
    if (updErr) {
      console.error("[christmas-checkout] purchase update failed:", updErr, "pi=", pi.id);
      return bad("purchase_update_failed", 500);
    }

    // 5) Referral attribution (best-effort; a referral failure must never break checkout).
    //    The referrer's reward only fires later, when the recipient confirms (Phase 3F).
    const refCode = body.referral_code?.trim();
    if (refCode) {
      try {
        const lookup = await findUsableReferralCode(refCode);
        // Self-referral guard: the buyer used their own code -> do not attribute.
        if (lookup && lookup.referrer_customer_id !== customer.id) {
          await recordChristmasGiftReferral({
            codeId: lookup.code_id,
            referrerCustomerId: lookup.referrer_customer_id,
            refereeChristmasGiftPurchaseId: purchaseId,
          });
        }
      } catch (e) {
        console.error("[christmas-checkout] referral attribution failed (non-blocking):", e);
      }
    }

    return NextResponse.json({
      ok: true,
      purchase_id: purchaseId,
      client_secret: pi.client_secret,
      customer_id: customer.id,
      amount_cents: win.chargedCents,
      window: win.window,
      dmfh_bonus: win.dmfhBonus,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "stripe_error";
    console.error("[christmas-checkout] stripe error:", message, "purchase=", purchaseId);
    // Leave the row in pending_payment; it never advances without a settled charge.
    return bad(message, 500);
  }
}
