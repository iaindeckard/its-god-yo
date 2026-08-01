import { NextResponse } from "next/server";
import { getActiveSponsors } from "@/lib/sponsors";
import { SPONSORS_ENABLED } from "@/lib/flags";

export const dynamic = "force-dynamic";

/** Public: the sponsors currently live for display (name + logo only). Used by
 *  the homepage rotator and the /sponsors thank-you page. No internal fields. */
export async function GET() {
  // Sponsor Program deprioritized 2026-08-01 — serve nothing publicly (see lib/flags).
  if (!SPONSORS_ENABLED) return NextResponse.json({ sponsors: [] });
  try {
    return NextResponse.json({ sponsors: await getActiveSponsors() });
  } catch (e) {
    return NextResponse.json({ sponsors: [], error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
