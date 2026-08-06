import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { getRolesCatalog, createRole, updateRole } from "@/lib/roleAdmin";

export const dynamic = "force-dynamic";

/** Roles/permissions/staff catalog for the admin UI. */
export async function GET() {
  try {
    await requirePermission("admin.roles.manage");
    return NextResponse.json(await getRolesCatalog());
  } catch (e) {
    return apiError(e);
  }
}

/** Create a new job role (key/label/description). */
export async function POST(req: Request) {
  try {
    await requirePermission("admin.roles.manage");
    const body = await req.json().catch(() => ({}));
    return NextResponse.json({ role: await createRole(body) });
  } catch (e) {
    return apiError(e);
  }
}

/** Edit an existing role's label/description (key is immutable). */
export async function PATCH(req: Request) {
  try {
    await requirePermission("admin.roles.manage");
    const body = await req.json().catch(() => ({}));
    if (!body.key) return NextResponse.json({ error: "key is required" }, { status: 400 });
    return NextResponse.json({ role: await updateRole(body.key, { label: body.label, description: body.description }) });
  } catch (e) {
    return apiError(e);
  }
}
