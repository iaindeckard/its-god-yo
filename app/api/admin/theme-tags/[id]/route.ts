import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { reviewTag } from "@/lib/themeTags";

export const dynamic = "force-dynamic";

/** Approve or reject a proposed theme tag. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const staff = await requirePermission("content.theme_tags.review");
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    if (body.decision !== "approve" && body.decision !== "reject") {
      return NextResponse.json({ error: "decision must be 'approve' or 'reject'" }, { status: 400 });
    }
    return NextResponse.json({ tag: await reviewTag(id, body.decision, staff) });
  } catch (e) {
    return apiError(e);
  }
}
