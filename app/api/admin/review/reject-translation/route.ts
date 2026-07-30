import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { invokeReviewFn } from "@/lib/reviewFunctions";

export const dynamic = "force-dynamic";

// Verse is fine, both AI attempts weren't: reviewer supplies the final text.
export async function POST(req: Request) {
  try {
    await requirePermission("content.queue.reject_translation");
    const body = await req.json().catch(() => ({}));
    if (!body.daily_slot_id || !body.corrected_translation?.trim() || !body.reason?.trim()) {
      return NextResponse.json({ error: "daily_slot_id, corrected_translation, and reason are required" }, { status: 400 });
    }
    return NextResponse.json(
      await invokeReviewFn("review-reject-translation", {
        daily_slot_id: body.daily_slot_id,
        corrected_translation: body.corrected_translation.trim(),
        reason: body.reason.trim(),
      }),
    );
  } catch (e) {
    return apiError(e);
  }
}
