import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { assessReport } from "@/lib/bounty";

export const dynamic = "force-dynamic";

/** On-demand AI assessment of one pending report group. Advisory only — drafts a
 *  verdict + proposed fix for the human to approve/edit/reject; never publishes. */
export async function POST(req: Request) {
  try {
    await requirePermission("finance.bounty.review");
    const body = await req.json().catch(() => ({}));
    if (typeof body.group_key !== "string" || !body.group_key) {
      return NextResponse.json({ error: "group_key is required" }, { status: 400 });
    }
    const result = await assessReport(body.group_key);
    return NextResponse.json({ result });
  } catch (e) {
    return apiError(e);
  }
}
