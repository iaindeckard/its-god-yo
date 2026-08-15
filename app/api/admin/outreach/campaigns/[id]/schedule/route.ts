import { NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { requirePermission } from "@/lib/rbac";
import { pauseCampaign, scheduleCampaign } from "@/lib/outreach/scheduler";

export const dynamic = "force-dynamic";

/** Human-owned schedule action. Captures the exact eligible audience at approval. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const staff = await requirePermission("marketing.outreach.manage");
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const leadIds: string[] = Array.isArray(body.lead_ids)
      ? Array.from(new Set<string>(body.lead_ids.filter((value: unknown): value is string => typeof value === "string"))).slice(0, 250)
      : [];
    if (typeof body.release_at !== "string" || typeof body.timezone !== "string" || !leadIds.length) {
      return NextResponse.json({ error: "release_at, timezone, and lead_ids are required" }, { status: 400 });
    }
    const campaign = await scheduleCampaign(id, {
      releaseAt: body.release_at, timezone: body.timezone, approvedBy: staff.userId, leadIds,
    });
    return NextResponse.json({ ok: true, campaign });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission("marketing.outreach.manage");
    const { id } = await params;
    return NextResponse.json({ ok: true, campaign: await pauseCampaign(id) });
  } catch (error) {
    return apiError(error);
  }
}
