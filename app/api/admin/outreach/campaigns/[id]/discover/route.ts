import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { getCampaign } from "@/lib/outreach/campaigns";
import { runCampaignDiscovery } from "@/lib/outreach/discovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Raised 300 -> 600 for the target=35 era: discovery does up to 8 web-search
// rounds + throttled per-lead geocoding, then insert, then the inline auto-verify
// page-fetch pass, ALL in this one invocation. Leads persist only after the loop,
// so a mid-run timeout discards the whole run. 600s (within Vercel Pro/Fluid limits)
// gives that combined path room to finish.
export const maxDuration = 600;

/**
 * Run geographic-scoped discovery for this campaign: loops the Claude web-search
 * agent within the campaign radius, geocodes + size-tags results, and inserts them
 * 'staged' (never auto-send). No-op (ran:false) if ANTHROPIC_API_KEY isn't set.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission("marketing.outreach.manage");
    const { id } = await params;
    const campaign = await getCampaign(id);
    if (!campaign) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const result = await runCampaignDiscovery(campaign);
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    return apiError(e);
  }
}
