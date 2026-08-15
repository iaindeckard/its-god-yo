import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { getCampaign } from "@/lib/outreach/campaigns";
import { continueCampaignDiscovery, latestDiscoveryRun } from "@/lib/outreach/discovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

/**
 * Run geographic-scoped discovery for this campaign: loops OpenAI web search
 * agent within the campaign radius, geocodes + size-tags results, and inserts them
 * 'staged' (never auto-send). The route requires the normal outreach-manage RBAC
 * permission and never promotes or sends a discovered lead.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission("marketing.outreach.manage");
    const { id } = await params;
    const campaign = await getCampaign(id);
    if (!campaign) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const run = await continueCampaignDiscovery(campaign);
    return NextResponse.json({ ok: true, run });
  } catch (e) {
    return apiError(e);
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission("marketing.outreach.manage");
    const { id } = await params;
    return NextResponse.json({ ok: true, run: await latestDiscoveryRun(id) });
  } catch (e) {
    return apiError(e);
  }
}
