import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { verifyRetryAccessToken } from "@/lib/preorder/token";
import { createSubscriptionForPendingSignup } from "@/lib/createSubscription";
import { activatedSms } from "@/lib/preorder/messages";
import { sendPreorderSms } from "@/lib/preorder/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://itsgodyo.com").replace(/\/$/, "");

/**
 * Payment-retry submit (spec step 6). The tokenized no-login page confirms a new
 * SetupIntent (new card) and posts the resulting payment_method_id here. We attach
 * it as the customer's default, then re-attempt the immediate charge via the same
 * activation path. Success -> active (welcome SMS, same as a fresh YES); another
 * decline -> stays payment_failed (original 7-day clock preserved — no reset).
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const ps: string = typeof body?.ps === "string" ? body.ps : "";
  const t: string = typeof body?.t === "string" ? body.t : "";
  const pmId: string = typeof body?.payment_method_id === "string" ? body.payment_method_id : "";

  if (!UUID_RE.test(ps) || !verifyRetryAccessToken(ps, t)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!pmId) return NextResponse.json({ error: "missing_payment_method" }, { status: 400 });

  const admin = getSupabaseAdmin();
  const { data: row } = await admin
    .from("pending_signups")
    .select("id, status, is_preorder, stripe_customer_id, teen_consent_id, language")
    .eq("id", ps)
    .maybeSingle();
  if (!row || !row.is_preorder) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (row.status !== "payment_failed") {
    // Already resolved or removed — nothing to charge.
    return NextResponse.json({ status: row.status, message: "no_action_needed" });
  }
  if (!row.stripe_customer_id) return NextResponse.json({ error: "not_ready" }, { status: 409 });

  const stripe = getStripe();
  try {
    // Attach + make the new card the customer default (SetupIntent confirmation
    // already attached it; this is idempotent and also sets it as default).
    await stripe.paymentMethods.attach(pmId, { customer: row.stripe_customer_id }).catch(() => {});
    await stripe.customers.update(row.stripe_customer_id, { invoice_settings: { default_payment_method: pmId } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "attach_failed" }, { status: 502 });
  }

  await admin.from("pending_signups").update({ stripe_payment_method_id: pmId }).eq("id", ps);

  const result = await createSubscriptionForPendingSignup(ps, { chargeImmediately: true });

  if (result.status === "created") {
    // Welcome the recipient(s), same as a successful YES.
    const { data: consents } = await admin
      .from("consent_log")
      .select("recipient_phone, recipient_first_name, language, welcome_token, consent_status")
      .or(`id.eq.${row.teen_consent_id},pending_signup_id.eq.${ps}`);
    for (const c of consents ?? []) {
      if (!c.recipient_phone || c.consent_status === "opted_out" || c.consent_status === "removed") continue;
      const lang = c.language === "es" ? "es" : "en";
      const welcomeUrl = c.welcome_token ? `${SITE}/welcome?c=${c.welcome_token}` : null;
      await sendPreorderSms(c.recipient_phone as string, activatedSms((c.recipient_first_name as string | null) ?? null, lang, welcomeUrl));
    }
    return NextResponse.json({ status: "active", subscription_id: result.subscription_id });
  }

  if (result.status === "payment_failed") {
    // Keep status payment_failed and the ORIGINAL payment_failed_at (no clock reset).
    return NextResponse.json({ status: "payment_failed", detail: result.detail });
  }

  return NextResponse.json({ status: result.status, detail: result.detail }, { status: 409 });
}
