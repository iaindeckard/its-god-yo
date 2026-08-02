-- Cornerstone: geocoded coordinates for the partner map/globe. Churches are
-- public/institutional addresses, so exact coordinates are fine to plot directly
-- (no jitter/rounding needed — unlike a private residence). Nullable + additive:
-- geocoding is best-effort at intake and never blocks an application; a null pair
-- falls back to a country-level centroid on the globe.
ALTER TABLE public.churches
  ADD COLUMN IF NOT EXISTS latitude   double precision,
  ADD COLUMN IF NOT EXISTS longitude  double precision,
  ADD COLUMN IF NOT EXISTS geocoded_at timestamptz;
