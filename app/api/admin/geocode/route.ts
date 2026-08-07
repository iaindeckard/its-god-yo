import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { geocodeAddress } from "@/lib/geocode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-side geocode proxy over lib/geocode.ts (keyless Nominatim). Used by the
 * campaign create form now, and by the Leaflet map's place-search in Phase 2.
 * Returns { lat, lng } or { lat: null } on a miss (never an error for a miss).
 */
export async function GET(req: Request) {
  try {
    await requirePermission("marketing.outreach.view");
    const q = new URL(req.url).searchParams.get("q")?.trim();
    if (!q) return NextResponse.json({ error: "q is required" }, { status: 400 });
    const coords = await geocodeAddress({ address: q, country: "United States" });
    return NextResponse.json({ lat: coords?.lat ?? null, lng: coords?.lng ?? null });
  } catch (e) {
    return apiError(e);
  }
}
