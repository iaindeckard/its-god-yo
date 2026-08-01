import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import {
  approveApplication, declineApplication, setApplicationStatus,
  type ApplicationStatus, APPLICATION_STATUSES,
} from "@/lib/cornerstone";

export const dynamic = "force-dynamic";

/**
 * Act on a single application. Body: { action: "approve" | "decline" | "set_status", ... }.
 * approve → assigns the permanent partner number via the transaction-safe RPC.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const staff = await requirePermission("partners.review");
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const action = body.action as string;

    if (action === "approve") {
      const result = await approveApplication(id, staff.userId, body.reason ?? null);
      return NextResponse.json({ ok: true, ...result });
    }
    if (action === "decline") {
      await declineApplication(id, staff.userId, body.reason ?? null);
      return NextResponse.json({ ok: true });
    }
    if (action === "set_status") {
      const status = body.status as ApplicationStatus;
      if (!APPLICATION_STATUSES.includes(status)) {
        return NextResponse.json({ error: "invalid status" }, { status: 400 });
      }
      await setApplicationStatus(id, status, staff.userId, body.internal_notes);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    return apiError(e);
  }
}
