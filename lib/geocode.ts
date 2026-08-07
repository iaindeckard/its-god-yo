import "server-only";

/**
 * Address → coordinates for the Cornerstone partner map. Uses Nominatim
 * (OpenStreetMap) — keyless, international (not US-zip-only), free. Our volume is
 * one geocode per application submission (dozens–hundreds total, human-paced),
 * which sits well within Nominatim's usage policy (≤1 req/s, descriptive
 * User-Agent). If volume/robustness ever needs a keyed provider (OpenCage /
 * Mapbox / Google), point GEOCODER_BASE_URL at a compatible endpoint or swap the
 * geocodeAddress body — callers don't care which provider answered.
 *
 * Best-effort by contract: any failure (bad address, timeout, service error)
 * returns null. Callers must NEVER fail the application over a geocode miss — a
 * null pair falls back to a country-level centroid on the globe.
 */

const NOMINATIM = (process.env.GEOCODER_BASE_URL || "https://nominatim.openstreetmap.org/search").replace(/\/$/, "");
const NOMINATIM_REVERSE = (process.env.GEOCODER_REVERSE_URL || "https://nominatim.openstreetmap.org/reverse").replace(/\/$/, "");
const USER_AGENT = "ItsGodYo-Cornerstone/1.0 (hello@itsgodyo.com)"; // required by Nominatim policy
const TIMEOUT_MS = 6000;

export interface AddressParts {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
}

export interface LatLng { lat: number; lng: number }

export async function geocodeAddress(parts: AddressParts): Promise<LatLng | null> {
  const q = [parts.address, parts.city, parts.state, parts.postalCode, parts.country]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join(", ");
  if (!q) return null;

  const url = `${NOMINATIM}?format=jsonv2&limit=1&addressdetails=0&q=${encodeURIComponent(q)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, signal: ctrl.signal });
    if (!res.ok) { console.error(`[geocode] ${res.status} for "${q}"`); return null; }
    const rows = (await res.json().catch(() => [])) as Array<{ lat?: string; lon?: string }>;
    const first = Array.isArray(rows) ? rows[0] : null;
    if (!first?.lat || !first?.lon) return null;
    const lat = Number(first.lat), lng = Number(first.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch (e) {
    console.error(`[geocode] failed for "${q}":`, e instanceof Error ? e.message : e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reverse geocode: coordinates -> a compact human label ("City, State"), used by
 * the outreach campaign map when the center pin is dragged. Same best-effort
 * contract as geocodeAddress: any failure returns null (the caller keeps whatever
 * label it had). Builds "City, State" from address parts when present, else falls
 * back to Nominatim's display_name.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const url = `${NOMINATIM_REVERSE}?format=jsonv2&addressdetails=1&zoom=12&lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lng))}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, signal: ctrl.signal });
    if (!res.ok) { console.error(`[reverse-geocode] ${res.status} for ${lat},${lng}`); return null; }
    const body = (await res.json().catch(() => null)) as
      | { display_name?: string; address?: Record<string, string> }
      | null;
    if (!body) return null;
    const a = body.address ?? {};
    const city = a.city || a.town || a.village || a.hamlet || a.county || null;
    const state = a.state || a.region || null;
    const compact = [city, state].filter(Boolean).join(", ");
    return compact || body.display_name || null;
  } catch (e) {
    console.error(`[reverse-geocode] failed for ${lat},${lng}:`, e instanceof Error ? e.message : e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Country-level centroids for the globe fallback when a church couldn't be
// geocoded. Keyed by a normalized country string; covers the likely markets
// (churches will skew US) plus common aliases. Not exhaustive — an unknown
// country just can't be placed (the church still shows in the flat list).
const COUNTRY_CENTROIDS: Record<string, LatLng> = {
  "united states": { lat: 39.83, lng: -98.58 }, usa: { lat: 39.83, lng: -98.58 }, us: { lat: 39.83, lng: -98.58 }, america: { lat: 39.83, lng: -98.58 },
  canada: { lat: 56.13, lng: -106.35 }, ca: { lat: 56.13, lng: -106.35 },
  mexico: { lat: 23.63, lng: -102.55 }, mx: { lat: 23.63, lng: -102.55 },
  "united kingdom": { lat: 54.0, lng: -2.0 }, uk: { lat: 54.0, lng: -2.0 }, "great britain": { lat: 54.0, lng: -2.0 }, england: { lat: 52.36, lng: -1.17 },
  ireland: { lat: 53.41, lng: -8.24 }, australia: { lat: -25.27, lng: 133.78 }, "new zealand": { lat: -40.9, lng: 174.89 },
  germany: { lat: 51.17, lng: 10.45 }, france: { lat: 46.23, lng: 2.21 }, spain: { lat: 40.46, lng: -3.75 }, italy: { lat: 41.87, lng: 12.57 },
  netherlands: { lat: 52.13, lng: 5.29 }, brazil: { lat: -14.24, lng: -51.93 }, argentina: { lat: -38.42, lng: -63.62 },
  colombia: { lat: 4.57, lng: -74.3 }, "south africa": { lat: -30.56, lng: 22.94 }, nigeria: { lat: 9.08, lng: 8.68 },
  kenya: { lat: -0.02, lng: 37.91 }, india: { lat: 20.59, lng: 78.96 }, philippines: { lat: 12.88, lng: 121.77 },
  "south korea": { lat: 35.91, lng: 127.77 }, japan: { lat: 36.2, lng: 138.25 },
};

export function countryCentroid(country: string | null | undefined): LatLng | null {
  if (!country) return null;
  const key = country.trim().toLowerCase().replace(/[.]/g, "");
  return COUNTRY_CENTROIDS[key] ?? null;
}
