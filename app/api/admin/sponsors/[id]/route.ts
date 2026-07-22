import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { updateSponsor } from "@/lib/sponsors";

export const dynamic = "force-dynamic";

/** Edit a sponsor, or transition status (vet -> active, or expire). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission("marketing.sponsors.manage");
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const patch: Record<string, unknown> = {};
    for (const k of ["name", "logo_url", "contact_email", "start_date", "end_date", "status", "vetting_notes", "billing_note", "stripe_customer_id"]) {
      if (body[k] !== undefined) patch[k] = body[k];
    }
    if (body.amount_cents !== undefined) patch.amount_cents = body.amount_cents === null ? null : Number(body.amount_cents);
    return NextResponse.json({ sponsor: await updateSponsor(id, patch) });
  } catch (e) {
    return apiError(e);
  }
}
