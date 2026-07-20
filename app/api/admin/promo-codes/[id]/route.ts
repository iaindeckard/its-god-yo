import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { updatePromoNote } from "@/lib/promoCodes";

export const dynamic = "force-dynamic";

/** Edit the editable surface of a promo code. Stripe codes are largely
 *  immutable, so this updates the internal note (metadata). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission("billing.promo_codes.edit");
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    if (typeof body.note !== "string") {
      return NextResponse.json({ error: "note (string) is required" }, { status: 400 });
    }
    return NextResponse.json({ promo_code: await updatePromoNote(id, body.note.trim()) });
  } catch (e) {
    return apiError(e);
  }
}
