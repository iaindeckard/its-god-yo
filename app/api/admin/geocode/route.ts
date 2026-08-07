import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { geocodeAddress, reverseGeocode } from "@/lib/geocode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-side geocode proxy over lib/geocode.ts (keyless Nominatim). Two modes:
 *   - forward: ?q=<place>        -> { lat, lng }  (map place-search + campaign create)
 *   - reverse: ?lat=&lng=        -> { label }     (map center-pin drag)
 * Misses return null values, never an error.
 */
export async function GET(req: Request) {
  try {
    await requirePermission("marketing.outreach.view");
    const params = new URL(req.url).searchParams;
    const latRaw = params.get("lat");
    const lngRaw = params.get("lng");
    if (latRaw != null && lngRaw != null) {
      const lat = Number(latRaw), lng = Number(lngRaw);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return NextResponse.json({ error: "lat and lng must be numbers" }, { status: 400 });
      }
      const label = await reverseGeocode(lat, lng);
      return NextResponse.json({ label });
    }
    const q = params.get("q")?.trim();
    if (!q) return NextResponse.json({ error: "q (or lat+lng) is required" }, { status: 400 });
    const coords = await geocodeAddress({ address: q, country: "United States" });
    return NextResponse.json({ lat: coords?.lat ?? null, lng: coords?.lng ?? null });
  } catch (e) {
    return apiError(e);
  }
}
