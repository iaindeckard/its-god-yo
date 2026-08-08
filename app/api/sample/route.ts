import { NextResponse } from "next/server";
import { getSampleVerses } from "@/lib/sampleVerses";

// Public, unauthenticated read of already-approved sample verses for the homepage
// teaser (the standalone /sample page reads getSampleVerses directly on the server).
// No signup, no capture, no gate; reshuffles per request. Touches no billing / SMS.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const raw = Number(new URL(req.url).searchParams.get("n"));
  const n = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 12) : 3;
  const verses = await getSampleVerses(n);
  return NextResponse.json({ verses }, { headers: { "Cache-Control": "no-store" } });
}
