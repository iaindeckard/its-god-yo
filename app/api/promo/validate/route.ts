import { NextResponse } from "next/server";
import { findUsablePromoCode } from "@/lib/promoCodes";

export const dynamic = "force-dynamic";

/**
 * Customer-facing promo-code validation for the signup flow. NOT admin-gated —
 * any prospective customer can check a code at checkout. Returns only
 * customer-safe fields (discount shape); never the internal note. Separate from
 * the referral field by design.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const code = (body.code || "").trim();
  // The plan the customer is buying — passed so tier restrictions and start
  // dates are actually enforced here, not merely displayed. Optional for
  // backwards compatibility; when omitted, tier restrictions are not applied.
  const planKey = typeof body.plan_key === "string" ? body.plan_key : undefined;
  if (!code) return NextResponse.json({ valid: false, error: "empty_code" }, { status: 400 });

  try {
    const pc = await findUsablePromoCode(code, planKey);
    if (!pc) return NextResponse.json({ valid: false });
    return NextResponse.json({
      valid: true,
      promotion_code_id: pc.id,
      code: pc.code,
      percent_off: pc.percent_off,
      amount_off: pc.amount_off, // cents
      currency: pc.currency,
      duration: pc.duration,
      // Surfaced so the signup flow can render + log the required attestation
      // (reusing the existing gift/+1 attestation-logging pattern).
      requires_attestation: pc.requires_attestation,
      attestation_text: pc.attestation_text,
    });
  } catch (e) {
    return NextResponse.json({ valid: false, error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
