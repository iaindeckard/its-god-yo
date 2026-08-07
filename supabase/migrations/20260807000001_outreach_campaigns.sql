-- Geographic-scoped outreach campaigns (Phase 1 of the approved architecture,
-- Drive: PLAN-APPROVED-IGY-Outreach-Geographic-Campaigns-Architecture-2026-08-07.md
-- + PLAN-APPROVED-IGY-Outreach-Phase1-Checklist-2026-08-07.md).
--
-- Turns the single global OUTREACH_GEOGRAPHY string into named, persistent,
-- ROI-attributable campaigns: each is a center point + radius the discovery agent
-- searches within, whose leads are size-segmented (attendance-based) and gated
-- behind a staged->active promote action before any send.
--
-- ADDITIVE + IDEMPOTENT. Legacy leads (the Wichita batch) keep campaign_id = NULL
-- and are untouched. Applied via MCP apply_migration (IGY has migration drift —
-- do NOT `supabase db push` this repo).

-- ---------------------------------------------------------------------------
-- outreach_campaigns — one row per saved, named search region.
-- Overlap policy = Option A (locked 2026-08-07): a church belongs to exactly one
-- campaign, enforced for free by the existing unique index on
-- lower(igy_outreach_leads.contact_email) — a church already known to any campaign
-- (or the legacy null-campaign leads) is skipped by insertDiscovered's
-- anti-resurrection check. Clean region ROI beats flexible overlap.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.outreach_campaigns (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  center_label     text NOT NULL,              -- the place typed, e.g. "Dallas, TX"
  center_lat       double precision,           -- geocoded on create; NULL if the geocode missed
  center_lng       double precision,
  radius_miles     numeric NOT NULL,
  -- The size buckets last promoted to send (NULL = all). Recorded so the campaign
  -- remembers which segment(s) were pushed.
  size_filter      text[],
  -- Offer config. STORED in Phase 1 but NOT yet branched on (send still uses the
  -- flat 10% code); per-campaign offer variance is a Phase 4 refinement. Present
  -- now so it's an additive fill-in, not a later schema change.
  discount_percent integer NOT NULL DEFAULT 10,
  message_variant  text,
  status           text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','discovering','ready','sending','archived')),
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Service-role only, matching igy_outreach_leads and the other back-office tables.
ALTER TABLE public.outreach_campaigns ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- igy_outreach_leads — additive columns for campaign membership, geocoding, and
-- attendance-based size segmentation.
-- ---------------------------------------------------------------------------
ALTER TABLE public.igy_outreach_leads
  ADD COLUMN IF NOT EXISTS campaign_id          uuid REFERENCES public.outreach_campaigns (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS latitude             double precision,
  ADD COLUMN IF NOT EXISTS longitude            double precision,
  ADD COLUMN IF NOT EXISTS geocoded_at          timestamptz,
  ADD COLUMN IF NOT EXISTS estimated_attendance integer,
  ADD COLUMN IF NOT EXISTS attendance_source_url text,
  ADD COLUMN IF NOT EXISTS size_bucket          text NOT NULL DEFAULT 'unknown'
                             CHECK (size_bucket IN ('small','medium','large','mega','unknown'));

CREATE INDEX IF NOT EXISTS idx_outreach_leads_campaign
  ON public.igy_outreach_leads (campaign_id) WHERE campaign_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Extend the status lifecycle with 'staged': campaign-discovered leads are born
-- staged (NOT send-eligible) and only enter the send pipeline when the admin
-- promotes a size-filtered subset staged->active. Legacy/global-cron leads keep
-- being born 'active' | 'needs_review' as before. Constraint name confirmed live:
-- igy_outreach_leads_status_check.
-- ---------------------------------------------------------------------------
ALTER TABLE public.igy_outreach_leads DROP CONSTRAINT IF EXISTS igy_outreach_leads_status_check;
ALTER TABLE public.igy_outreach_leads ADD CONSTRAINT igy_outreach_leads_status_check
  CHECK (status IN ('active','converted','unsubscribed','bounced_hard','needs_review','aged_out','staged'));
