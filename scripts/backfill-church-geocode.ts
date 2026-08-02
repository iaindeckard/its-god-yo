/**
 * Backfill geocoded coordinates for Cornerstone partner churches.
 *
 * The intake path (submitApplication) geocodes each church once at submission, so
 * churches created after the geocode feature shipped already have coordinates.
 * This script fills in the gap for churches that predate the feature (or whose
 * intake geocode failed) so the partner globe can plot them precisely instead of
 * at a country centroid.
 *
 * SCOPE: churches tied to a LISTED, non-revoked cornerstone_partner (the exact set
 * the public globe/directory shows) that are missing latitude/longitude. Idempotent
 * — a church that already has coordinates is skipped, so re-running is safe.
 *
 * BEST-EFFORT, per the same contract as intake: a failed geocode for one church is
 * logged and skipped; it NEVER aborts the rest of the backfill. A church left
 * without coordinates simply falls back to a country centroid on the globe.
 *
 * This is meant to run against PRODUCTION (that's the point — it backfills real
 * partner data). It only ever writes latitude/longitude/geocoded_at; it touches no
 * other column and creates/deletes no rows.
 *
 * PREREQUISITES (env)
 *   NEXT_PUBLIC_SUPABASE_URL / SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   (optional) GEOCODER_BASE_URL   # override Nominatim, e.g. a keyed provider
 *
 * HOW TO RUN
 *   lib/ modules use `import "server-only"`, which throws outside a React Server
 *   Component. Resolve it to its empty export via the react-server condition:
 *
 *     NODE_OPTIONS='--conditions=react-server' npx tsx scripts/backfill-church-geocode.ts
 *
 *   Add --dry-run to list what WOULD be geocoded without writing anything.
 *   (Install tsx if needed: `npm i -D tsx`.)
 */

import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { geocodeAddress } from "../lib/geocode";

// Nominatim's usage policy asks for <= 1 request/second. Our volume is tiny, so a
// simple serial loop with a >1s pause between calls stays well within it.
const THROTTLE_MS = 1100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const DRY_RUN = process.argv.includes("--dry-run");

interface ChurchRow {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state_province: string | null;
  postal_code: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
}

async function main() {
  const admin = getSupabaseAdmin();

  // The churches shown on the globe: tied to a LISTED, non-revoked partner. We pull
  // the church coords too so we can skip the ones already geocoded.
  const { data, error } = await admin
    .from("cornerstone_partners")
    .select(
      "church:churches(id, name, address, city, state_province, postal_code, country, latitude, longitude)"
    )
    .eq("public_listing_status", "listed")
    .neq("cornerstone_status", "revoked");
  if (error) throw new Error(`partner_query_failed: ${error.message}`);

  // Dedupe by church id (a church maps to one partner, but be defensive) and keep
  // only those actually missing coordinates.
  const byId = new Map<string, ChurchRow>();
  for (const row of (data ?? []) as unknown as { church: ChurchRow | null }[]) {
    const c = row.church;
    if (c && c.id && !byId.has(c.id)) byId.set(c.id, c);
  }
  const candidates = [...byId.values()].filter((c) => c.latitude == null || c.longitude == null);

  console.log(
    `[backfill] listed partner churches: ${byId.size} · already geocoded: ${byId.size - candidates.length} · to process: ${candidates.length}` +
      (DRY_RUN ? "  (DRY RUN — no writes)" : "")
  );
  if (candidates.length === 0) {
    console.log("[backfill] nothing to do — no-op. Plumbing verified.");
    return;
  }

  let ok = 0;
  let missed = 0; // geocode returned null (unresolvable address)
  let failed = 0; // unexpected error on this church (logged, does NOT abort)

  for (const c of candidates) {
    const label = `${c.name} [${c.id.slice(0, 8)}]`;
    try {
      const coord = await geocodeAddress({
        address: c.address,
        city: c.city,
        state: c.state_province,
        postalCode: c.postal_code,
        country: c.country,
      });
      if (!coord) {
        missed++;
        console.warn(`[backfill] no coords for ${label} — leaving null (country-centroid fallback)`);
      } else if (DRY_RUN) {
        ok++;
        console.log(`[backfill] would set ${label} -> ${coord.lat.toFixed(4)}, ${coord.lng.toFixed(4)}`);
      } else {
        const { error: upErr } = await admin
          .from("churches")
          .update({ latitude: coord.lat, longitude: coord.lng, geocoded_at: new Date().toISOString() })
          .eq("id", c.id);
        if (upErr) throw new Error(upErr.message);
        ok++;
        console.log(`[backfill] set ${label} -> ${coord.lat.toFixed(4)}, ${coord.lng.toFixed(4)}`);
      }
    } catch (e) {
      failed++;
      console.error(`[backfill] error for ${label}:`, e instanceof Error ? e.message : e);
    }
    await sleep(THROTTLE_MS); // respect Nominatim rate policy
  }

  console.log(`[backfill] done — geocoded: ${ok}, unresolvable: ${missed}, errored: ${failed}${DRY_RUN ? " (dry run)" : ""}`);
}

main().catch((e) => {
  console.error("[backfill] fatal:", e instanceof Error ? e.message : e);
  process.exit(1);
});
