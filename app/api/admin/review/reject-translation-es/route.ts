import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { invokeReviewFn } from "@/lib/reviewFunctions";
import { isValidCategory, labelForCategory, OTHER_KEY } from "@/lib/rejectionReasons";

export const dynamic = "force-dynamic";

// Spanish counterpart of reject-translation/route.ts. Same category taxonomy
// (the reasons a translation gets rejected — meaning drift, tone, etc. — apply
// regardless of language), routed to the ES edge function.
export async function POST(req: Request) {
  try {
    await requirePermission("content.queue.reject_translation");
    const body = await req.json().catch(() => ({}));
    const category: string = typeof body.category === "string" ? body.category.trim() : "";
    if (!body.daily_slot_id || !body.corrected_translation?.trim() || !category) {
      return NextResponse.json({ error: "daily_slot_id, corrected_translation, and category are required" }, { status: 400 });
    }
    if (!isValidCategory("translation", category)) {
      return NextResponse.json({ error: `invalid category for translation rejection: ${category}` }, { status: 400 });
    }
    const note: string = typeof body.reason === "string" ? body.reason.trim() : "";
    if (category === OTHER_KEY && !note) {
      return NextResponse.json({ error: "a free-text reason is required when category is 'other'" }, { status: 400 });
    }
    const reason = category === OTHER_KEY ? note : labelForCategory(category)!;
    return NextResponse.json(
      await invokeReviewFn("review-reject-translation-es", {
        daily_slot_id: body.daily_slot_id,
        corrected_translation: body.corrected_translation.trim(),
        reason,
        category,
      }),
    );
  } catch (e) {
    return apiError(e);
  }
}
