import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { listThresholds, createThreshold } from "@/lib/consentThresholds";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requirePermission("admin.consent_thresholds.manage");
    return NextResponse.json({ thresholds: await listThresholds() });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    await requirePermission("admin.consent_thresholds.manage");
    const body = await req.json().catch(() => ({}));
    const code = (body.country_code || "").trim();
    if (!/^[A-Za-z]{2}$/.test(code)) {
      return NextResponse.json({ error: "country_code must be a 2-letter ISO code" }, { status: 400 });
    }
    return NextResponse.json({ threshold: await createThreshold(code) });
  } catch (e) {
    return apiError(e);
  }
}
