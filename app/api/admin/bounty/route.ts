import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { getReviewGroups, getBountyLedger, getBountyCorrections } from "@/lib/bounty";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requirePermission("finance.bounty.view");
    const [groups, ledger, corrections] = await Promise.all([
      getReviewGroups("pending"),
      getBountyLedger(),
      getBountyCorrections(),
    ]);
    return NextResponse.json({ groups, ledger, corrections });
  } catch (e) {
    return apiError(e);
  }
}
