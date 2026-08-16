import { NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { requirePermission } from "@/lib/rbac";
import { generateReinvestmentProposal, getReinvestmentPolicy, listReinvestmentProposals, updateReinvestmentPolicy } from "@/lib/outreach/reinvestment";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requirePermission("marketing.outreach.view");
    const [policy, proposals] = await Promise.all([getReinvestmentPolicy(), listReinvestmentProposals()]);
    return NextResponse.json({ policy, proposals });
  } catch (error) { return apiError(error); }
}

export async function POST(req: Request) {
  try {
    const staff = await requirePermission("marketing.outreach.manage");
    const body = await req.json().catch(() => ({}));
    if (body.action === "generate") {
      return NextResponse.json({ proposal: await generateReinvestmentProposal(staff.userId) });
    }
    if (body.action === "update_policy") {
      return NextResponse.json({ policy: await updateReinvestmentPolicy(body.policy ?? {}, staff.userId) });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (error) { return apiError(error); }
}
