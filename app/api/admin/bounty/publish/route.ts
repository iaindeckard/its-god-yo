import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { publishCorrection } from "@/lib/bounty";

export const dynamic = "force-dynamic";

/**
 * Approve + publish an error-bounty correction to live daily content. Gated behind
 * content.queue.publish (super_admin only) — this edits live scripture. Body:
 * { group_key, final_text } where final_text is the AI's proposed fix or the
 * admin's edited version. Publishes, logs to corrections_log, then rewards.
 */
export async function POST(req: Request) {
  try {
    const staff = await requirePermission("content.queue.publish");
    const body = await req.json().catch(() => ({}));
    if (typeof body.group_key !== "string" || !body.group_key) {
      return NextResponse.json({ error: "group_key is required" }, { status: 400 });
    }
    if (typeof body.final_text !== "string" || !body.final_text.trim()) {
      return NextResponse.json({ error: "final_text (the corrected text) is required" }, { status: 400 });
    }
    const result = await publishCorrection(body.group_key, body.final_text, staff, body.note);
    return NextResponse.json({ result });
  } catch (e) {
    return apiError(e);
  }
}
