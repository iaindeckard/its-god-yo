import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { updatePromoMeta } from "@/lib/promoCodes";

export const dynamic = "force-dynamic";

/** Edit the editable surface of a promo code. Stripe codes are largely
 *  immutable, so this updates the internal label / note (metadata). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission("billing.promo_codes.edit");
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const fields: { label?: string; note?: string } = {};
    if (typeof body.label === "string") fields.label = body.label.trim();
    if (typeof body.note === "string") fields.note = body.note.trim();
    if (fields.label === undefined && fields.note === undefined) {
      return NextResponse.json({ error: "label and/or note (string) is required" }, { status: 400 });
    }
    return NextResponse.json({ promo_code: await updatePromoMeta(id, fields) });
  } catch (e) {
    return apiError(e);
  }
}
