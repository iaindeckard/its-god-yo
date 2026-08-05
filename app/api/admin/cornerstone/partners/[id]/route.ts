import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { updatePartner, resendPartnerStatusLink, type PartnerPatch } from "@/lib/cornerstone";
import {
  getOrCreateEnrollmentLink, getEnrollmentProgress, rotateEnrollmentLink,
  pauseEnrollmentLink, reactivateEnrollmentLink, getEnrollmentLink,
} from "@/lib/churchEnrollment";

export const dynamic = "force-dynamic";

const FIELDS: (keyof PartnerPatch)[] = [
  "cornerstone_status", "public_listing_status", "locked_pricing_status",
  "locked_pricing_terms", "original_qualifying_plan", "original_qualifying_price_cents",
  "early_access_eligible", "activation_date", "inactive_date",
];

/**
 * Manage a partner record (status, public listing, locked pricing). Never accepts
 * partner_number — it is permanent (the DB guard trigger would reject a change).
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const staff = await requirePermission("partners.manage");
    const { id } = await params;
    const body = await req.json().catch(() => ({}));

    // Recovery: re-email the church its private status link ("lost your link").
    if (body.action === "resend_link") {
      const res = await resendPartnerStatusLink(id);
      return NextResponse.json({ ok: true, ...res });
    }

    // Group enrollment link management (Phase 1).
    if (typeof body.action === "string" && body.action.startsWith("enrollment_")) {
      if (body.action === "enrollment_rotate") {
        const link = await rotateEnrollmentLink(id, staff.userId);
        return NextResponse.json({ ok: true, link, progress: await getEnrollmentProgress(id) });
      }
      if (body.action === "enrollment_pause" || body.action === "enrollment_reactivate") {
        const current = await getEnrollmentLink(id);
        if (current) {
          if (body.action === "enrollment_pause") await pauseEnrollmentLink(current.id);
          else await reactivateEnrollmentLink(current.id);
        }
      }
      // enrollment_status (default): just read. Ensures a link exists so staff
      // always see a code to share.
      const link = await getOrCreateEnrollmentLink(id, staff.userId);
      return NextResponse.json({ ok: true, link, progress: await getEnrollmentProgress(id) });
    }

    const patch: PartnerPatch = {};
    for (const k of FIELDS) {
      if (body[k] !== undefined) (patch as Record<string, unknown>)[k] = body[k];
    }
    const partner = await updatePartner(id, patch, staff.userId, body.reason ?? null);
    return NextResponse.json({ partner });
  } catch (e) {
    return apiError(e);
  }
}
