import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { reviewPronounProposal } from "@/lib/pronounReview";

export const dynamic = "force-dynamic";

/**
 * Approve (apply the corrected text + clear the flag) or reject (discard) one
 * pronoun-correction proposal. Approving writes daily_slots.final_translation, so
 * it is gated by content.queue.approve — the same permission the translation queue
 * uses to approve content.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const staff = await requirePermission("content.queue.approve");
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    if (body.decision !== "approve" && body.decision !== "reject") {
      return NextResponse.json({ error: "decision must be 'approve' or 'reject'" }, { status: 400 });
    }
    return NextResponse.json({ proposal: await reviewPronounProposal(id, body.decision, staff) });
  } catch (e) {
    return apiError(e);
  }
}
