import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { recordDisbursement } from "@/lib/donationFund";

export const dynamic = "force-dynamic";

/** Record a manual donation. Server refuses amounts above the available balance. */
export async function POST(req: Request) {
  try {
    const staff = await requirePermission("finance.donation_fund.disburse");
    const body = await req.json().catch(() => ({}));

    const charityName = typeof body.charityName === "string" ? body.charityName.trim() : "";
    if (!charityName) return NextResponse.json({ error: "charityName is required" }, { status: 400 });

    const amountDollars = Number(body.amount);
    if (!amountDollars || amountDollars <= 0) {
      return NextResponse.json({ error: "amount must be a positive number (dollars)" }, { status: 400 });
    }

    const summary = await recordDisbursement({
      charityName,
      amountCents: Math.round(amountDollars * 100),
      disbursedOn: body.disbursedOn || undefined,
      reference: body.reference || undefined,
      notes: body.notes || undefined,
      triggeredBy: staff.userId || staff.jobRole,
    });
    return NextResponse.json({ summary });
  } catch (e) {
    return apiError(e);
  }
}
