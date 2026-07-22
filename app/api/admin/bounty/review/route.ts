import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { confirmGroup } from "@/lib/bounty";

export const dynamic = "force-dynamic";

/** Confirm (issue a credit to the earliest reporter, cap-permitting) or reject a report group. */
export async function POST(req: Request) {
  try {
    const staff = await requirePermission("finance.bounty.review");
    const body = await req.json().catch(() => ({}));
    if (typeof body.group_key !== "string" || !body.group_key) {
      return NextResponse.json({ error: "group_key is required" }, { status: 400 });
    }
    if (body.decision !== "confirm" && body.decision !== "reject") {
      return NextResponse.json({ error: "decision must be 'confirm' or 'reject'" }, { status: 400 });
    }
    const result = await confirmGroup(body.group_key, body.decision, staff, body.note);
    return NextResponse.json({ result });
  } catch (e) {
    return apiError(e);
  }
}
