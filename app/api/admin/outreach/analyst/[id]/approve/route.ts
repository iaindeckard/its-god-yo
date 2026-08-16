import { NextResponse } from "next/server";
import { requirePermission, getCurrentStaff } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { createCampaign, deleteDraftCampaign } from "@/lib/outreach/campaigns";
import { approveMarketingProposal, getMarketingProposal } from "@/lib/outreach/marketing-analyst";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission("marketing.outreach.manage");
    const staff = await getCurrentStaff();
    const { id } = await params;
    const proposal = await getMarketingProposal(id);
    if (!proposal) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (proposal.auto_drafts_created_at) return NextResponse.json({ error: "Draft campaigns were already created automatically for this analysis." }, { status: 409 });
    if (proposal.status !== "draft") return NextResponse.json({ error: "proposal_already_decided" }, { status: 409 });
    const body = await req.json().catch(() => ({}));
    const marketIndex = Number(body.market_index);
    const market = proposal.analysis.recommendations[marketIndex];
    if (!Number.isInteger(marketIndex) || !market) return NextResponse.json({ error: "invalid market_index" }, { status: 400 });
    const campaign = await createCampaign({
      name: `${market.market_name} | ${proposal.objective.replaceAll("_", " ")}`,
      centerLabel: market.center_label,
      radiusMiles: market.radius_miles,
      createdBy: staff?.userId ?? null,
    });
    try {
      await approveMarketingProposal(id, marketIndex, campaign.id, staff?.userId ?? null);
    } catch (error) {
      await deleteDraftCampaign(campaign.id).catch(() => {});
      throw error;
    }
    return NextResponse.json({ campaign, approved: true });
  } catch (error) {
    return apiError(error);
  }
}
