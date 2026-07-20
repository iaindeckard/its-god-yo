import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { deactivatePromoCode } from "@/lib/promoCodes";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission("billing.promo_codes.deactivate");
    const { id } = await params;
    return NextResponse.json({ promo_code: await deactivatePromoCode(id) });
  } catch (e) {
    return apiError(e);
  }
}
