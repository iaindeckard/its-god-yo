import { NextResponse } from "next/server";
import { findUsableReferralCode } from "@/lib/referral";

export const dynamic = "force-dynamic";

/**
 * Customer-facing referral-code validation for the signup flow. NOT admin-gated.
 * Returns only whether the code is usable — never the referrer's identity.
 * Promo⊕referral mutual-exclusivity is enforced in the checkout UI, and
 * self-referral is enforced at attach/conversion time (when the referee's own
 * customer id is known).
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const code = (body.code || "").trim();
  if (!code) return NextResponse.json({ valid: false, error: "empty_code" }, { status: 400 });
  try {
    const found = await findUsableReferralCode(code);
    return NextResponse.json({ valid: !!found });
  } catch (e) {
    return NextResponse.json({ valid: false, error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
