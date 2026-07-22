import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { applyCredit } from "@/lib/bounty";

export const dynamic = "force-dynamic";

/** Manually redeem an earned credit — the deliberate human checkpoint. */
export async function POST(req: Request) {
  try {
    const staff = await requirePermission("finance.bounty.apply");
    const body = await req.json().catch(() => ({}));
    if (typeof body.credit_id !== "string" || !body.credit_id) {
      return NextResponse.json({ error: "credit_id is required" }, { status: 400 });
    }
    const ledger = await applyCredit(body.credit_id, staff, body.note);
    return NextResponse.json({ ledger });
  } catch (e) {
    return apiError(e);
  }
}
