import { NextResponse } from "next/server";
import { getActiveSponsors } from "@/lib/sponsors";

export const dynamic = "force-dynamic";

/** Public: the sponsors currently live for display (name + logo only). Used by
 *  the homepage rotator and the /sponsors thank-you page. No internal fields. */
export async function GET() {
  try {
    return NextResponse.json({ sponsors: await getActiveSponsors() });
  } catch (e) {
    return NextResponse.json({ sponsors: [], error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
