import { NextResponse } from "next/server";
import { CORNERSTONE_ENABLED } from "@/lib/flags";
import { verifyPartnerAccessToken } from "@/lib/cornerstone";
import { isActivePartner } from "@/lib/churchEnrollment";
import { saveRoster, ROSTER_MAX_NAMES } from "@/lib/churchRoster";

export const dynamic = "force-dynamic";

/**
 * Save a church's roster names — Phase 2 tracker. Authenticated by the same
 * signed partner token that gates the church status page (no login exists), so a
 * minister with their status link can edit their own roster and nobody else's.
 * Names only; this endpoint never touches phone numbers, consent, or billing.
 */
export async function POST(req: Request) {
  if (!CORNERSTONE_ENABLED) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const p = typeof body?.p === "string" ? body.p : "";
  const t = typeof body?.t === "string" ? body.t : "";
  const names = Array.isArray(body?.names) ? body.names.filter((n: unknown) => typeof n === "string") : null;

  // Token check first, and return the SAME 404 as the status page on any failure
  // so nothing about a partner is revealed.
  if (!p || !t || !verifyPartnerAccessToken(p, t)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!names) return NextResponse.json({ error: "names must be an array of strings" }, { status: 400 });
  if (names.length > ROSTER_MAX_NAMES) {
    return NextResponse.json({ error: `too_many_names (max ${ROSTER_MAX_NAMES})` }, { status: 400 });
  }

  try {
    if (!(await isActivePartner(p))) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const status = await saveRoster(p, names);
    return NextResponse.json({ ok: true, status });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "roster_save_failed" }, { status: 500 });
  }
}
