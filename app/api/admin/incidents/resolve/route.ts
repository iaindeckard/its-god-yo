import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveAlert } from "@/lib/alertState";
import { getIncidents } from "@/lib/landing";

export const dynamic = "force-dynamic";

/** Acknowledge (dismiss) one or all active incidents from the landing page.
 *  Flips igy_alert_state.resolved → true via resolve_alert, so the row drops out
 *  of getIncidents() immediately. The condition is unchanged, so if the issue is
 *  still real the next monitor run re-fires the alert. System-level ops signals,
 *  gated to super_admin (admin.roles.manage). */
export async function POST(req: Request) {
  try {
    await requirePermission("admin.roles.manage");
    const body = await req.json().catch(() => ({}));
    const admin = getSupabaseAdmin();

    // Dismiss every currently-active incident.
    if (body?.all === true) {
      const incidents = await getIncidents();
      let resolved = 0;
      for (const i of incidents) {
        if (await resolveAlert(admin, { alertType: i.alert_type, entityKey: i.entity_key })) resolved++;
      }
      return NextResponse.json({ ok: true, resolved });
    }

    // Dismiss a single incident, keyed by (alert_type, entity_key).
    const alertType = typeof body?.alertType === "string" ? body.alertType.trim() : "";
    if (!alertType) return NextResponse.json({ error: "alertType required" }, { status: 400 });
    const entityKey = typeof body?.entityKey === "string" ? body.entityKey : "";
    const resolved = await resolveAlert(admin, { alertType, entityKey });
    return NextResponse.json({ ok: true, resolved });
  } catch (e) {
    return apiError(e);
  }
}
