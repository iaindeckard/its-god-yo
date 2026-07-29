import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { invokeReviewFn, reviewerId } from "@/lib/reviewFunctions";

export const dynamic = "force-dynamic";

// Start/end a tracked review session (wraps review-session-start /
// review-session-end). Gated by content.queue.view — anyone who can see the
// queue can open a session.
export async function POST(req: Request) {
  try {
    await requirePermission("content.queue.view");
    const body = await req.json().catch(() => ({}));
    if (body.action === "start") {
      return NextResponse.json(await invokeReviewFn("review-session-start", { reviewer_id: await reviewerId() }));
    }
    if (body.action === "end") {
      if (!body.review_session_id) {
        return NextResponse.json({ error: "review_session_id is required to end a session" }, { status: 400 });
      }
      return NextResponse.json(
        await invokeReviewFn("review-session-end", {
          review_session_id: body.review_session_id,
          notes: body.notes,
        }),
      );
    }
    return NextResponse.json({ error: "action must be 'start' or 'end'" }, { status: 400 });
  } catch (e) {
    return apiError(e);
  }
}
