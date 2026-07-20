import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { listPromoCodes, createPromoCode } from "@/lib/promoCodes";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requirePermission("billing.promo_codes.view");
    return NextResponse.json({ promo_codes: await listPromoCodes() });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    await requirePermission("billing.promo_codes.create");
    const body = await req.json().catch(() => ({}));

    if (body.discountType !== "percent" && body.discountType !== "amount") {
      return NextResponse.json({ error: "discountType must be 'percent' or 'amount'" }, { status: 400 });
    }
    const value = Number(body.value);
    if (!value || value <= 0) return NextResponse.json({ error: "value must be a positive number" }, { status: 400 });
    if (body.discountType === "percent" && value > 100) {
      return NextResponse.json({ error: "percent value must be 1–100" }, { status: 400 });
    }

    const created = await createPromoCode({
      code: body.code?.trim() || undefined,
      discountType: body.discountType,
      value,
      currency: body.currency,
      duration: ["once", "forever", "repeating"].includes(body.duration) ? body.duration : "once",
      durationInMonths: body.durationInMonths ? Number(body.durationInMonths) : undefined,
      maxRedemptions: body.maxRedemptions ? Number(body.maxRedemptions) : null,
      expiresAt: body.expiresAt ? Math.floor(new Date(body.expiresAt).getTime() / 1000) : null,
      note: body.note?.trim() || undefined,
    });
    return NextResponse.json({ promo_code: created });
  } catch (e) {
    return apiError(e);
  }
}
