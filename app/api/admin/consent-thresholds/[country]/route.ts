import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { updateThreshold, type ThresholdPatch } from "@/lib/consentThresholds";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ country: string }> }) {
  try {
    await requirePermission("admin.consent_thresholds.manage");
    const { country } = await params;
    const body = await req.json().catch(() => ({}));

    const patch: ThresholdPatch = {};
    if (body.minimum_age_for_self_consent !== undefined) {
      const n = Number(body.minimum_age_for_self_consent);
      if (!Number.isInteger(n) || n < 0 || n > 25) {
        return NextResponse.json({ error: "minimum_age_for_self_consent must be an integer 0–25" }, { status: 400 });
      }
      patch.minimum_age_for_self_consent = n;
    }
    if (body.attorney_confirmed !== undefined) patch.attorney_confirmed = !!body.attorney_confirmed;
    if (body.attorney_confirmed_by !== undefined) patch.attorney_confirmed_by = body.attorney_confirmed_by?.trim() || null;
    if (body.required_consent_mechanism !== undefined) patch.required_consent_mechanism = body.required_consent_mechanism?.trim() || null;
    if (body.notes !== undefined) patch.notes = body.notes?.trim() || null;

    // Guard: don't let a row be marked confirmed without recording who confirmed it.
    if (patch.attorney_confirmed === true && !(patch.attorney_confirmed_by || body.attorney_confirmed_by)) {
      return NextResponse.json({ error: "attorney_confirmed_by is required when marking a country attorney-confirmed" }, { status: 400 });
    }

    return NextResponse.json({ threshold: await updateThreshold(country, patch) });
  } catch (e) {
    return apiError(e);
  }
}
