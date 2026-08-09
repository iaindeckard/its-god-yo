import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { applyManualOverride } from "@/lib/outreach/verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Manually clear a lead's verification (mark it 'manual_override' so it can send),
 * for the false-negative case — a real church whose page couldn't be fetched
 * (JS-only site, timeout, blocked). Deliberately a SEPARATE, higher-bar permission
 * from running verification: this pushes a lead past the automated safety check,
 * so it requires marketing.outreach.verify_override (Super Admin by default,
 * assignable to other roles in /admin/roles). No user id is hardcoded — authz is
 * purely has_permission().
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const staff = await requirePermission("marketing.outreach.verify_override");
    const { id } = await params;
    const updated = await applyManualOverride(id, staff.userId);
    if (!updated) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
