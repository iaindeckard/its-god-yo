import { NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { requirePermission } from "@/lib/rbac";
import { approveAndExecuteReinvestment, rejectReinvestment } from "@/lib/outreach/reinvestment";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const staff = await requirePermission("marketing.outreach.reinvestment.approve");
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    if (body.action === "approve") return NextResponse.json({ proposal: await approveAndExecuteReinvestment(id, staff.userId) });
    if (body.action === "reject") {
      await rejectReinvestment(id, staff.userId);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (error) { return apiError(error); }
}
