import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { invokeReviewFn } from "@/lib/reviewFunctions";
import { isValidCategory, labelForCategory, OTHER_KEY } from "@/lib/rejectionReasons";

export const dynamic = "force-dynamic";

// Reject the verse entirely -> the existing function regenerates BOTH AI outputs
// (real AI cost). Optionally threads a review_session_id so end-of-session
// unresolved detection works.
//
// The rejection reason is now a STRUCTURED category (lib/rejectionReasons.ts),
// stored in corrections_log.category for later analytics. reason is the human
// text: the category label for a preset, or the reviewer's free text for "other".
export async function POST(req: Request) {
  try {
    await requirePermission("content.queue.reject_verse");
    const body = await req.json().catch(() => ({}));
    const category: string = typeof body.category === "string" ? body.category.trim() : "";
    if (!body.daily_slot_id || !category) {
      return NextResponse.json({ error: "daily_slot_id and category are required" }, { status: 400 });
    }
    if (!isValidCategory("verse", category)) {
      return NextResponse.json({ error: `invalid category for verse rejection: ${category}` }, { status: 400 });
    }
    const note: string = typeof body.reason === "string" ? body.reason.trim() : "";
    if (category === OTHER_KEY && !note) {
      return NextResponse.json({ error: "a free-text reason is required when category is 'other'" }, { status: 400 });
    }
    const reason = category === OTHER_KEY ? note : labelForCategory(category)!;
    const payload: Record<string, unknown> = {
      daily_slot_id: body.daily_slot_id,
      reason,
      category,
    };
    if (body.review_session_id) payload.review_session_id = body.review_session_id;
    return NextResponse.json(await invokeReviewFn("review-reject-verse", payload));
  } catch (e) {
    return apiError(e);
  }
}
