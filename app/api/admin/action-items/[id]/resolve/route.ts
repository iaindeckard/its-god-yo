import { NextResponse } from "next/server";
import { requirePermission, getCurrentStaff } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { resolveActionItem } from "@/lib/actionItems";

export const dynamic = "force-dynamic";

/** Resolve (clear) a billing/dispute action item from the landing page. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission("finance.action_items.view");
    const { id } = await params;
    const staff = await getCurrentStaff();
    const body = await req.json().catch(() => ({}));
    const note = typeof body.note === "string" ? body.note.trim() || undefined : undefined;
    const resolved = await resolveActionItem(id, staff?.userId ?? null, note);
    return NextResponse.json({ ok: true, resolved });
  } catch (e) {
    return apiError(e);
  }
}
