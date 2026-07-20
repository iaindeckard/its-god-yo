import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { getReviewQueue } from "@/lib/reviewQueue";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requirePermission("content.queue.view");
    return NextResponse.json({ slots: await getReviewQueue() });
  } catch (e) {
    return apiError(e);
  }
}
