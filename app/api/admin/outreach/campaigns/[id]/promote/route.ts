import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { getCampaign, updateCampaign } from "@/lib/outreach/campaigns";
import { promoteLeads } from "@/lib/outreach/leads";

export const dynamic = "force-dynamic";

/**
 * Promote an exact or size-filtered subset of this campaign's eligible STAGED
 * leads into the send pipeline. Body: { ids?: string[], sizeBuckets?: string[] }.
 * This is the gate — nothing in a campaign can send until promoted here. The
 * campaign size_filter is updated only when legacy bucket mode is used.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission("marketing.outreach.manage");
    const { id } = await params;
    const campaign = await getCampaign(id);
    if (!campaign) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const body = await req.json().catch(() => ({}));
    const sizeBuckets = Array.isArray(body.sizeBuckets)
      ? body.sizeBuckets.filter((value: unknown): value is string => typeof value === "string")
      : undefined;
    const ids: string[] | undefined = Array.isArray(body.ids)
      ? Array.from(new Set<string>(body.ids.filter((value: unknown): value is string => typeof value === "string"))).slice(0, 250)
      : undefined;
    if ((!sizeBuckets || !sizeBuckets.length) && (!ids || !ids.length)) {
      return NextResponse.json({ error: "provide sizeBuckets or ids to promote" }, { status: 400 });
    }
    const promoted = await promoteLeads(id, { sizeBuckets, ids });
    if (sizeBuckets && sizeBuckets.length) {
      await updateCampaign(id, { size_filter: sizeBuckets }).catch(() => {});
    }
    return NextResponse.json({ ok: true, promoted });
  } catch (e) {
    return apiError(e);
  }
}
