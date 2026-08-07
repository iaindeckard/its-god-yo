import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { listPromoCodes, createPromoCode } from "@/lib/promoCodes";
import { TIER_KEYS } from "@/lib/tiers";
import { REQUIRED_ADDON_IDS } from "@/lib/requiredAddons";

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

    const requiresAttestation = body.requiresAttestation === true;
    const attestationText = body.attestationText?.trim() || undefined;
    if (requiresAttestation && !attestationText) {
      return NextResponse.json(
        { error: "attestationText is required when requiresAttestation is true" },
        { status: 400 },
      );
    }

    const allowedTiers = Array.isArray(body.allowedTiers)
      ? body.allowedTiers.filter((t: unknown) => typeof t === "string" && TIER_KEYS.includes(t))
      : [];

    const requiredAddons = Array.isArray(body.requiredAddons)
      ? body.requiredAddons.filter((a: unknown) => typeof a === "string" && REQUIRED_ADDON_IDS.includes(a))
      : [];

    const startsAt = body.startsAt ? Math.floor(new Date(body.startsAt).getTime() / 1000) : null;
    const expiresAt = body.expiresAt ? Math.floor(new Date(body.expiresAt).getTime() / 1000) : null;
    if (startsAt && expiresAt && startsAt >= expiresAt) {
      return NextResponse.json({ error: "start date must be before the end date" }, { status: 400 });
    }

    const maxPerCustomer = body.maxPerCustomer ? Number(body.maxPerCustomer) : null;
    if (maxPerCustomer != null && (!Number.isInteger(maxPerCustomer) || maxPerCustomer < 1)) {
      return NextResponse.json({ error: "maxPerCustomer must be a positive integer" }, { status: 400 });
    }

    const created = await createPromoCode({
      code: body.code?.trim() || undefined,
      discountType: body.discountType,
      value,
      currency: body.currency,
      duration: ["once", "forever", "repeating"].includes(body.duration) ? body.duration : "once",
      durationInMonths: body.durationInMonths ? Number(body.durationInMonths) : undefined,
      maxRedemptions: body.maxRedemptions ? Number(body.maxRedemptions) : null,
      expiresAt,
      startsAt,
      internalLabel: body.internalLabel?.trim() || undefined,
      note: body.note?.trim() || undefined,
      maxPerCustomer,
      firstTimeOnly: body.firstTimeOnly === true,
      requiresAttestation,
      attestationText,
      allowedTiers,
      requiredAddons,
    });
    return NextResponse.json({ promo_code: created });
  } catch (e) {
    return apiError(e);
  }
}
