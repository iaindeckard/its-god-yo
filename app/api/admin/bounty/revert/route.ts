import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { revertCorrection } from "@/lib/bounty";

export const dynamic = "force-dynamic";

/**
 * Undo a published bounty correction — restores the slot's pre-correction text and
 * logs a bounty_revert. Content-only (does not touch the reward). Gated behind
 * content.queue.publish (super_admin). Body: { corrections_log_id }.
 */
export async function POST(req: Request) {
  try {
    const staff = await requirePermission("content.queue.publish");
    const body = await req.json().catch(() => ({}));
    if (typeof body.corrections_log_id !== "string" || !body.corrections_log_id) {
      return NextResponse.json({ error: "corrections_log_id is required" }, { status: 400 });
    }
    const result = await revertCorrection(body.corrections_log_id, staff);
    return NextResponse.json({ result });
  } catch (e) {
    return apiError(e);
  }
}
