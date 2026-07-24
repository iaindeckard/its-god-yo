import { NextResponse } from "next/server";
import { findUsableReferralCode, recordReferralAtSignup } from "@/lib/referral";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/**
 * Records referral attribution (a pending referral_events row) for a
 * just-created pending signup. Best-effort by design: the signup already
 * succeeded before this is called, and conversion re-resolves attribution from
 * the code stored on pending_signups, so a failure here is non-fatal.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const code = (body.code || "").trim();
  const pendingSignupId = typeof body.pendingSignupId === "string" ? body.pendingSignupId : "";
  if (!code || !pendingSignupId) {
    return NextResponse.json({ attached: false, error: "missing_params" }, { status: 400 });
  }

  try {
    const found = await findUsableReferralCode(code);
    if (!found) return NextResponse.json({ attached: false, reason: "code_not_usable" });

    // Self-referral guard: skip if the referee (this signup) is the code's owner.
    const admin = getSupabaseAdmin();
    const { data: ps } = await admin
      .from("pending_signups")
      .select("stripe_customer_id")
      .eq("id", pendingSignupId)
      .maybeSingle();
    if (ps?.stripe_customer_id && ps.stripe_customer_id === found.referrer_customer_id) {
      return NextResponse.json({ attached: false, reason: "self_referral" });
    }

    const r = await recordReferralAtSignup({
      codeId: found.code_id,
      referrerCustomerId: found.referrer_customer_id,
      refereePendingSignupId: pendingSignupId,
    });
    return NextResponse.json({ attached: r.status === "recorded", status: r.status });
  } catch (e) {
    return NextResponse.json({ attached: false, error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
