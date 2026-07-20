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
  if (!code) return NextResponse.json({ valid: false, error: "empty_code" }, { status: 400 });

  try {
    const pc = await findUsablePromoCode(code);
    if (!pc) return NextResponse.json({ valid: false });
    return NextResponse.json({
      valid: true,
      promotion_code_id: pc.id,
      code: pc.code,
      percent_off: pc.percent_off,
      amount_off: pc.amount_off, // cents
      currency: pc.currency,
      duration: pc.duration,
    });
  } catch (e) {
    return NextResponse.json({ valid: false, error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
