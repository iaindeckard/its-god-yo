import "server-only";
import { getSupabaseAdmin } from "./supabaseAdmin";
import { sendSmsAlert, SMS_ALERT } from "./smsAlert";

/**
 * Tier 3 security signal (LOCKED 2026-08-06, signal chosen by Iain): repeated
 * authenticated-but-denied admin access attempts. Called from the RBAC chokepoint
 * (lib/rbac.requirePermission) on a ForbiddenError — i.e. a logged-in principal
 * hitting an admin permission they lack, which is the "probing" case worth an
 * emergency SMS. A single denial (one mis-click by a limited role) must not fire;
 * only THRESHOLD failures by the same principal within WINDOW_MIN do, and the 4h
 * cooldown (per principal) keeps a sustained attack to one clear signal.
 *
 * Best-effort by contract: every path here swallows its own errors so this can
 * never interfere with the auth decision it observes.
 */

const WINDOW_MIN = 15;
const THRESHOLD = 5;

export async function reportAdminAccessFailure(args: {
  principal: string;
  permissionKey?: string;
}): Promise<void> {
  try {
    const db = getSupabaseAdmin();
    await db.from("igy_admin_access_failures").insert({
      principal: args.principal,
      permission_key: args.permissionKey ?? null,
    });

    const sinceIso = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();
    const { count } = await db
      .from("igy_admin_access_failures")
      .select("*", { count: "exact", head: true })
      .eq("principal", args.principal)
      .gte("created_at", sinceIso);

    if ((count ?? 0) >= THRESHOLD) {
      await sendSmsAlert({
        alertType: SMS_ALERT.SECURITY_EVENT,
        entityKey: args.principal,
        message: `${count} denied admin access attempts by user ${args.principal} in ${WINDOW_MIN} min (latest perm: ${args.permissionKey ?? "?"}).`,
        detail: `Repeated authenticated-but-denied admin requests from user_id=${args.principal} (>= ${THRESHOLD} in ${WINDOW_MIN} min). Possible unauthorized access probing or a compromised staff session. Check staff_members and recent auth activity.`,
        db,
      });
    }
  } catch (e) {
    console.error("[security-alert] reportAdminAccessFailure failed:", e instanceof Error ? e.message : e);
  }
}
