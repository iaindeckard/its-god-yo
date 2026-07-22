import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { getFundSummary } from "@/lib/donationFund";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requirePermission("finance.donation_fund.view");
    return NextResponse.json({ summary: await getFundSummary() });
  } catch (e) {
    return apiError(e);
  }
}
