import { NextResponse } from "next/server";
import { requirePermission, getCurrentStaff } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { listCampaigns, createCampaign } from "@/lib/outreach/campaigns";

export const dynamic = "force-dynamic";

/** List all outreach campaigns (newest first). */
export async function GET() {
  try {
    await requirePermission("marketing.outreach.view");
    return NextResponse.json({ campaigns: await listCampaigns() });
  } catch (e) {
    return apiError(e);
  }
}

/** Create a campaign (name + place + radius). The center is geocoded on the way in. */
export async function POST(req: Request) {
  try {
    await requirePermission("marketing.outreach.manage");
    const staff = await getCurrentStaff();
    const body = await req.json().catch(() => ({}));
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const centerLabel = typeof body.center_label === "string" ? body.center_label.trim() : "";
    const radiusMiles = Number(body.radius_miles);
    if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
    if (!centerLabel) return NextResponse.json({ error: "center_label is required" }, { status: 400 });
    if (!Number.isFinite(radiusMiles) || radiusMiles <= 0) {
      return NextResponse.json({ error: "radius_miles must be a positive number" }, { status: 400 });
    }
    const centerLat = body.center_lat != null ? Number(body.center_lat) : null;
    const centerLng = body.center_lng != null ? Number(body.center_lng) : null;
    const campaign = await createCampaign({
      name,
      centerLabel,
      radiusMiles,
      sizeFilter: Array.isArray(body.size_filter) ? body.size_filter : null,
      createdBy: staff?.userId ?? null,
      centerLat: Number.isFinite(centerLat as number) ? centerLat : null,
      centerLng: Number.isFinite(centerLng as number) ? centerLng : null,
    });
    return NextResponse.json({ campaign });
  } catch (e) {
    return apiError(e);
  }
}
