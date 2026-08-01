import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { listApplications, type ApplicationStatus, APPLICATION_STATUSES } from "@/lib/cornerstone";

export const dynamic = "force-dynamic";

/** List Cornerstone applications (each with its church embedded). Optional ?status filter. */
export async function GET(req: Request) {
  try {
    await requirePermission("partners.view");
    const status = new URL(req.url).searchParams.get("status");
    const filter = status && APPLICATION_STATUSES.includes(status as ApplicationStatus)
      ? (status as ApplicationStatus)
      : undefined;
    return NextResponse.json({ applications: await listApplications(filter) });
  } catch (e) {
    return apiError(e);
  }
}
