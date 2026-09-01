import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { invokeReviewFn } from "@/lib/reviewFunctions";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * ONE-OFF diagnostic, 2026-09-01: forwards to the divine-cap-rescan edge
 * function, which re-checks already-generated Spanish content against the
 * just-fixed divine-capitalization gate without regenerating anything.
 */
export async function POST(req: Request) {
  try {
    await requirePermission("content.generate");
    const body = await req.json().catch(() => ({}));
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json({ error: "items must be a non-empty array" }, { status: 400 });
    }
    const result = await invokeReviewFn("divine-cap-rescan", { items: body.items });
    return NextResponse.json(result);
  } catch (e) {
    return apiError(e);
  }
}
