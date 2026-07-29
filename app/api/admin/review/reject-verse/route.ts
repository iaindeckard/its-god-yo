import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { invokeReviewFn, reviewerId } from "@/lib/reviewFunctions";

export const dynamic = "force-dynamic";

// Reject the verse entirely -> the existing function regenerates BOTH AI outputs
// (real AI cost). Optionally threads a review_session_id so end-of-session
// unresolved detection works.
export async function POST(req: Request) {
  try {
    await requirePermission("content.queue.reject_verse");
    const body = await req.json().catch(() => ({}));
    if (!body.daily_slot_id || !body.reason?.trim()) {
      return NextResponse.json({ error: "daily_slot_id and reason are required" }, { status: 400 });
    }
    const payload: Record<string, unknown> = {
      daily_slot_id: body.daily_slot_id,
      reason: body.reason.trim(),
      reviewer_id: await reviewerId(),
    };
    if (body.review_session_id) payload.review_session_id = body.review_session_id;
    return NextResponse.json(await invokeReviewFn("review-reject-verse", payload));
  } catch (e) {
    return apiError(e);
  }
}
