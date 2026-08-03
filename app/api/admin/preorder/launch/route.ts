import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { runLaunchTrigger } from "@/lib/preorder/launch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PERM = "billing.preorder.launch";

/** Current counts across the preorder state machine (for the admin panel). */
export async function GET() {
  try {
    await requirePermission(PERM);
    const admin = getSupabaseAdmin();
    const states = ["preorder_pending", "awaiting_confirmation", "payment_failed", "active", "removed"] as const;
    const counts: Record<string, number> = {};
    await Promise.all(
      states.map(async (st) => {
        const { count } = await admin
          .from("pending_signups")
          .select("id", { count: "exact", head: true })
          .eq("is_preorder", true)
          .eq("status", st);
        counts[st] = count ?? 0;
      }),
    );
    return NextResponse.json({ counts });
  } catch (e) {
    return apiError(e);
  }
}

/**
 * Fire the launch trigger. Body { dry?: boolean } — dry=true previews without
 * sending or changing any rows. Real runs are idempotent-ish: only rows still in
 * preorder_pending are affected, so an accidental double-fire is harmless.
 */
export async function POST(req: Request) {
  try {
    await requirePermission(PERM);
    const body = await req.json().catch(() => ({}));
    const summary = await runLaunchTrigger(body?.dry === true);
    return NextResponse.json({ summary });
  } catch (e) {
    return apiError(e);
  }
}
