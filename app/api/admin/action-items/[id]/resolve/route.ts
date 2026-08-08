import { NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { resolveActionItem } from "@/lib/actionItems";

export const dynamic = "force-dynamic";

/** Resolve (clear) an action item from the landing page. Covers every kind in the
 *  queue — billing/dispute (finance.action_items.view) and outreach replies
 *  (outreach.replies.view) — so either permission may resolve. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const staff = await requireAnyPermission(["finance.action_items.view", "outreach.replies.view"]);
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const note = typeof body.note === "string" ? body.note.trim() || undefined : undefined;
    const resolved = await resolveActionItem(id, staff?.userId ?? null, note);
    return NextResponse.json({ ok: true, resolved });
  } catch (e) {
    return apiError(e);
  }
}
