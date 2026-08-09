import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { getCampaign } from "@/lib/outreach/campaigns";
import { verifyLeads } from "@/lib/outreach/verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Run (or re-run) verification for every lead in this campaign: each lead's
 * source page is checked for the org + a youth-ministry signal, and its email
 * domain is MX-checked. Both pass -> 'passed'; anything else -> 'needs_manual'
 * (never auto-rejected). A 'manual_override' lead is left untouched. Gated by
 * marketing.outreach.manage (same as discover/promote/send).
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission("marketing.outreach.manage");
    const { id } = await params;
    const campaign = await getCampaign(id);
    if (!campaign) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const result = await verifyLeads({ campaignId: id });
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    return apiError(e);
  }
}
