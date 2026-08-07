import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { getCampaign, updateCampaign } from "@/lib/outreach/campaigns";
import { promoteLeads } from "@/lib/outreach/leads";

export const dynamic = "force-dynamic";

/**
 * Promote a size-filtered subset of this campaign's STAGED leads into the send
 * pipeline (staged -> active). Body: { sizeBuckets?: string[], ids?: string[] }.
 * This is the gate — nothing in a campaign can send until promoted here. Records
 * the promoted buckets on the campaign's size_filter.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission("marketing.outreach.manage");
    const { id } = await params;
    const campaign = await getCampaign(id);
    if (!campaign) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const body = await req.json().catch(() => ({}));
    const sizeBuckets = Array.isArray(body.sizeBuckets) ? body.sizeBuckets : undefined;
    const ids = Array.isArray(body.ids) ? body.ids : undefined;
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
