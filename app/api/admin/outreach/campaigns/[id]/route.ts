import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { getCampaign, updateCampaign, type CampaignPatch, type CampaignStatus } from "@/lib/outreach/campaigns";
import { fetchCampaignLeads } from "@/lib/outreach/leads";

export const dynamic = "force-dynamic";

/** A campaign plus all of its leads (any status), for the admin detail view. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission("marketing.outreach.view");
    const { id } = await params;
    const campaign = await getCampaign(id);
    if (!campaign) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const leads = await fetchCampaignLeads(id);
    return NextResponse.json({ campaign, leads });
  } catch (e) {
    return apiError(e);
  }
}

const STATUSES: CampaignStatus[] = ["draft", "discovering", "ready", "sending", "archived"];

/** Edit a campaign (name, status, size_filter, radius). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission("marketing.outreach.manage");
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const patch: CampaignPatch = {};
    if (typeof body.name === "string") patch.name = body.name.trim();
    if (typeof body.status === "string") {
      if (!STATUSES.includes(body.status)) return NextResponse.json({ error: "invalid status" }, { status: 400 });
      patch.status = body.status;
    }
    if (body.size_filter === null || Array.isArray(body.size_filter)) patch.size_filter = body.size_filter;
    if (body.radius_miles !== undefined) patch.radius_miles = Number(body.radius_miles);
    if (body.center_lat !== undefined) patch.center_lat = body.center_lat === null ? null : Number(body.center_lat);
    if (body.center_lng !== undefined) patch.center_lng = body.center_lng === null ? null : Number(body.center_lng);
    if (typeof body.center_label === "string") patch.center_label = body.center_label.trim();
    return NextResponse.json({ campaign: await updateCampaign(id, patch) });
  } catch (e) {
    return apiError(e);
  }
}
