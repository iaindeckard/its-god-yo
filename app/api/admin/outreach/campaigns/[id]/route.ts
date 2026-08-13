import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { getCampaign, updateCampaign, type CampaignPatch, type CampaignStatus } from "@/lib/outreach/campaigns";
import { fetchCampaignLeads } from "@/lib/outreach/leads";
import { clampDiscountPercent, isApprovedVariant } from "@/lib/outreach/templates";
import { listCampaignDeliveries } from "@/lib/outreach/deliveries";
import { latestDiscoveryRun } from "@/lib/outreach/discovery";

export const dynamic = "force-dynamic";

/** A campaign plus all of its leads (any status), for the admin detail view. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission("marketing.outreach.view");
    const { id } = await params;
    const campaign = await getCampaign(id);
    if (!campaign) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const [leads, deliveries, discoveryRun] = await Promise.all([
      fetchCampaignLeads(id), listCampaignDeliveries(id), latestDiscoveryRun(id),
    ]);
    return NextResponse.json({ campaign, leads, deliveries, discoveryRun });
  } catch (e) {
    return apiError(e);
  }
}

const STATUSES: CampaignStatus[] = ["draft", "discovering", "ready", "paused", "archived"];

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
    // Offer (Phase 4a): discount is clamped to a valid Stripe percent; the message
    // variant must be an APPROVED key (free text is rejected, never stored) so a
    // campaign can never carry unreviewed copy.
    if (body.discount_percent !== undefined) patch.discount_percent = clampDiscountPercent(Number(body.discount_percent));
    if (body.message_variant !== undefined) {
      if (!isApprovedVariant(body.message_variant)) return NextResponse.json({ error: "unknown message_variant" }, { status: 400 });
      patch.message_variant = body.message_variant;
    }
    return NextResponse.json({ campaign: await updateCampaign(id, patch) });
  } catch (e) {
    return apiError(e);
  }
}
