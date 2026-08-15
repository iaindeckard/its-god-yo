import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { getCampaign } from "@/lib/outreach/campaigns";
import { runSend } from "@/lib/outreach/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Isolated per-campaign "send now". Fires the outreach send scoped to THIS
 * campaign's explicitly selected active leads only, separate from the
 * company-wide active-lead cycle. Body: { leadIds: string[], dry?: boolean }.
 *
 * Still fully governed by the send gate + OUTREACH_SEND_ALLOWLIST — scope controls
 * WHO and WHEN, never WHETHER. `dry` defaults to TRUE so the admin gets a preview
 * (the SendReport) and must explicitly pass dry:false to attempt a live send (and
 * even then, the env send gate must be open or it stays a dry-run).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission("marketing.outreach.manage");
    const { id } = await params;
    const campaign = await getCampaign(id);
    if (!campaign) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const body = await req.json().catch(() => ({}));
    const sizeBuckets = Array.isArray(body.sizeBuckets) && body.sizeBuckets.length ? body.sizeBuckets : undefined;
    const leadIds: string[] | undefined = Array.isArray(body.leadIds)
      ? Array.from(new Set<string>(body.leadIds.filter((value: unknown): value is string => typeof value === "string"))).slice(0, 250)
      : undefined;
    if (!leadIds?.length) return NextResponse.json({ error: "select preview recipients" }, { status: 400 });
    const forceDry = body.dry !== false; // default dry-run unless explicitly dry:false
    const report = await runSend({ campaignId: id, sizeBuckets, leadIds, forceDry });
    return NextResponse.json({ ok: true, report });
  } catch (e) {
    return apiError(e);
  }
}
