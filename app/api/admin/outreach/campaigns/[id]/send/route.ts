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
 * campaign's active (promoted) leads only, separate from the company-wide
 * active-lead cycle. Body: { sizeBuckets?: string[], dry?: boolean }.
 *
 * `dry` defaults to TRUE. A live request must include both dry:false and the
 * explicit confirmed:true acknowledgement sent only after the admin accepts the
 * Deploy warning. Verification, suppression, due-date and optional allowlist
 * gates remain enforced server-side. Automated sends retain the env gates.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission("marketing.outreach.manage");
    const { id } = await params;
    const campaign = await getCampaign(id);
    if (!campaign) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const body = await req.json().catch(() => ({}));
    const sizeBuckets = Array.isArray(body.sizeBuckets) && body.sizeBuckets.length ? body.sizeBuckets : undefined;
    const forceDry = body.dry !== false;
    const manualDeploy = !forceDry && body.confirmed === true;
    if (!forceDry && !manualDeploy) {
      return NextResponse.json({ error: "deploy_confirmation_required" }, { status: 400 });
    }
    const report = await runSend({ campaignId: id, sizeBuckets, forceDry, manualDeploy });
    return NextResponse.json({ ok: true, report });
  } catch (e) {
    return apiError(e);
  }
}
