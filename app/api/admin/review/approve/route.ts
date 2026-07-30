import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { invokeReviewFn } from "@/lib/reviewFunctions";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    await requirePermission("content.queue.approve");
    const body = await req.json().catch(() => ({}));
    if (!body.daily_slot_id || (body.chosen_output !== "a" && body.chosen_output !== "b")) {
      return NextResponse.json({ error: "daily_slot_id and chosen_output ('a'|'b') are required" }, { status: 400 });
    }
    const result = await invokeReviewFn("review-approve", {
      daily_slot_id: body.daily_slot_id,
      chosen_output: body.chosen_output,
    });
    return NextResponse.json(result);
  } catch (e) {
    return apiError(e);
  }
}
