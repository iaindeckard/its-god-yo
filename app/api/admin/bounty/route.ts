import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { getReviewGroups, getBountyLedger } from "@/lib/bounty";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requirePermission("finance.bounty.view");
    const [groups, ledger] = await Promise.all([getReviewGroups("pending"), getBountyLedger()]);
    return NextResponse.json({ groups, ledger });
  } catch (e) {
    return apiError(e);
  }
}
