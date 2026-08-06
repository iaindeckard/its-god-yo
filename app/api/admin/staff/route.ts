import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { listStaff, onboardStaff } from "@/lib/roleAdmin";

export const dynamic = "force-dynamic";

/** Current staff (with resolved emails). */
export async function GET() {
  try {
    await requirePermission("admin.roles.manage");
    return NextResponse.json({ staff: await listStaff() });
  } catch (e) {
    return apiError(e);
  }
}

/** Onboard a staff member: email + assigned role -> ensure an auth user, upsert
 *  the staff_members row. */
export async function POST(req: Request) {
  try {
    await requirePermission("admin.roles.manage");
    const body = await req.json().catch(() => ({}));
    if (!body.email || !body.job_role) return NextResponse.json({ error: "email and job_role are required" }, { status: 400 });
    return NextResponse.json(await onboardStaff({ email: body.email, job_role: body.job_role }));
  } catch (e) {
    return apiError(e);
  }
}
