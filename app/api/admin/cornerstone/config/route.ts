import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { getConfig, updateConfig, type ConfigPatch } from "@/lib/cornerstone";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requirePermission("partners.view");
    return NextResponse.json({ config: await getConfig() });
  } catch (e) {
    return apiError(e);
  }
}

const BOOL = ["program_active", "auto_approval_enabled", "manual_approval_required", "public_recognition_default"] as const;
const PASS = ["enrollment_opens_at", "enrollment_closes_at", "eligible_plans", "pricing_lock_rules", "terms_version", "certificate_scripture"] as const;

/** Update the single-row program config. This is what flips manual→auto approval
 *  without a redeploy — the launch requirement. */
export async function PATCH(req: Request) {
  try {
    const staff = await requirePermission("partners.manage");
    const body = await req.json().catch(() => ({}));
    const patch: ConfigPatch = {};
    for (const k of BOOL) if (body[k] !== undefined) (patch as Record<string, unknown>)[k] = !!body[k];
    for (const k of PASS) if (body[k] !== undefined) (patch as Record<string, unknown>)[k] = body[k];
    return NextResponse.json({ config: await updateConfig(patch, staff.userId) });
  } catch (e) {
    return apiError(e);
  }
}
