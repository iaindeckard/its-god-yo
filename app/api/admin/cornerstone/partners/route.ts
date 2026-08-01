import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { listPartners } from "@/lib/cornerstone";

export const dynamic = "force-dynamic";

/** List all Cornerstone Partners (ordered by permanent partner number, church embedded). */
export async function GET() {
  try {
    await requirePermission("partners.view");
    return NextResponse.json({ partners: await listPartners() });
  } catch (e) {
    return apiError(e);
  }
}
