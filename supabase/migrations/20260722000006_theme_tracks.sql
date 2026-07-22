-- Theme/Mood selection feature — Option A (multi-track batch generation).
-- Specs: IGY-Theme-Mood-Selection-Feature-Spec-2026-07-21.md +
--        IGY-Theme-Mood-Architecture-LOCKED-2026-07-22.md.
--
-- Model: a small curated set of THEME TRACKS. Each track gets its OWN monthly
-- batch (the existing month-M+2 process, run once per track). Subscribers pick
-- ONE track at signup (default 'general' = the current random behavior). Verses
-- are matched to a track via verse_theme_tags — an AI-assisted first pass
-- proposes fits, a human approves them (reusing the review workflow); generation
-- for a themed track pulls only from that track's APPROVED tags.
--
-- NOT price-differentiated (no Stripe change) — flagged separately.

-- ─────────────────────────────────────────────────────────────────────────────
-- theme_tracks — the curated track catalog. 'general' is the default track and
-- keeps the existing random-from-full-eligible-pool behavior.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.theme_tracks (
  key         text PRIMARY KEY,
  label       text NOT NULL,
  description text,
  sort_order  integer NOT NULL DEFAULT 0,
  is_default  boolean NOT NULL DEFAULT false,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.theme_tracks (key, label, description, sort_order, is_default) VALUES
  ('general',            'General',              'No preference — the daily verse everyone gets. Drawn from the full eligible pool.', 0, true),
  ('joy_gratitude',      'Joy & gratitude',      'Verses about joy, thankfulness, and praise.',                       1, false),
  ('gods_love_grace',    'God''s love & grace',  'Verses about God''s love, mercy, and grace.',                       2, false),
  ('patience_peace',     'Patience & peace',     'Verses about patience, calm, rest, and peace.',                     3, false),
  ('honesty_integrity',  'Honesty & integrity',  'Verses about truth, honesty, and living with integrity.',           4, false),
  ('courage_confidence', 'Courage & confidence', 'Verses about courage, strength, and confidence.',                   5, false),
  ('comfort_hard_times', 'Comfort in hard times','Verses of comfort for grief, fear, and hard seasons.',              6, false)
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- verse_theme_tags — which verses belong to which track. Populated by the
-- AI-assisted first pass as 'proposed', then a human moves them to
-- 'approved'/'rejected'. Only 'approved' rows feed a track's generation.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.verse_theme_tags (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  verse_ref         text NOT NULL,                          -- "Book C:V", matches daily_slots.verse_ref
  theme_track       text NOT NULL REFERENCES public.theme_tracks(key),
  status            text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','rejected')),
  proposed_by       text,                                    -- e.g. 'ai:claude-sonnet-4-6'
  confidence        numeric,                                 -- AI fit confidence 0..1 (optional)
  rationale         text,                                    -- short AI reason for the fit
  reviewed_by       uuid,
  reviewed_at       timestamptz,
  review_session_id uuid REFERENCES public.review_sessions(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (verse_ref, theme_track)
);
CREATE INDEX IF NOT EXISTS idx_verse_theme_tags_track_status ON public.verse_theme_tags (theme_track, status);

-- ─────────────────────────────────────────────────────────────────────────────
-- daily_slots — was one row per date (single shared slot). Now one row per
-- (date, theme_track): each track has its own reviewed verse for the day.
-- Existing rows become the 'general' track.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.daily_slots
  ADD COLUMN IF NOT EXISTS theme_track text NOT NULL DEFAULT 'general' REFERENCES public.theme_tracks(key);
ALTER TABLE public.daily_slots DROP CONSTRAINT IF EXISTS daily_slots_scheduled_date_key;
CREATE UNIQUE INDEX IF NOT EXISTS daily_slots_date_track_key ON public.daily_slots (scheduled_date, theme_track);

-- Per-track dedup: a verse used in one track doesn't block another track.
ALTER TABLE public.used_verses
  ADD COLUMN IF NOT EXISTS theme_track text NOT NULL DEFAULT 'general' REFERENCES public.theme_tracks(key);

-- The subscriber's chosen track lives on the subscription record.
ALTER TABLE public.pending_signups
  ADD COLUMN IF NOT EXISTS theme_track text NOT NULL DEFAULT 'general' REFERENCES public.theme_tracks(key);

-- ─────────────────────────────────────────────────────────────────────────────
-- Permissions — theme-tag review reuses the content-review muscle.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.permissions (key, label, category) VALUES
  ('content.theme_tags.view',   'View proposed theme/mood verse tags',   'content'),
  ('content.theme_tags.review', 'Approve/reject theme/mood verse tags',   'content')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (job_role, permission_key, enabled) VALUES
  ('super_admin',      'content.theme_tags.view',   true),
  ('super_admin',      'content.theme_tags.review', true),
  ('content_reviewer', 'content.theme_tags.view',   true),
  ('content_reviewer', 'content.theme_tags.review', true)
ON CONFLICT (job_role, permission_key) DO UPDATE SET enabled = EXCLUDED.enabled;

-- RLS on the new tables (service-role only, like the rest of the content engine).
ALTER TABLE public.theme_tracks     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verse_theme_tags ENABLE ROW LEVEL SECURITY;
