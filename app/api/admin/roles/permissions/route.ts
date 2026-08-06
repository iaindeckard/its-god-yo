import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { setRolePermission } from "@/lib/roleAdmin";

export const dynamic = "force-dynamic";

/** Toggle one permission on/off for a role (writes role_permissions.enabled).
 *  super_admin is rejected in the lib layer so it can't be locked out. */
export async function PATCH(req: Request) {
  try {
    await requirePermission("admin.roles.manage");
    const body = await req.json().catch(() => ({}));
    const { job_role, permission_key, enabled } = body;
    if (!job_role || !permission_key || typeof enabled !== "boolean") {
      return NextResponse.json({ error: "job_role, permission_key, and boolean enabled are required" }, { status: 400 });
    }
    await setRolePermission(job_role, permission_key, enabled);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
