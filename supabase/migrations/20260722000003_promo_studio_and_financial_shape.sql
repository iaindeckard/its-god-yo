-- Promo Code Studio + Admin Dashboard scaffolding — foundation migration.
-- See IGY-Promo-Studio-and-Admin-Dashboard-SPEC-2026-07-22.md.
--
-- Two things happen here, both additive:
--   (A) One new RBAC permission — analytics.revenue.view — mirroring USN's
--       "dashboard.view vs finance.view" split so the ARR Impact Simulator's
--       dollar figures can gate FINER than plain dashboard access. Follows the
--       existing explicit-(role,permission)-row seed pattern.
--   (B) Part 4 "DEI roll-up readiness — data SHAPE only, no DEI UI": a
--       business_units concept + an igy_monthly_financials rollup table whose
--       metric definitions deliberately MIRROR USN's business_units +
--       usn_monthly_financials, so a future DEI ETL is a real UNION across the
--       three separate Supabase projects (usn-production, its-god-yo,
--       dei-financial) rather than a rebuild. This migration only shapes the
--       tables; it does NOT populate them or build any rollup.

-- ─────────────────────────────────────────────────────────────────────────────
-- (A) analytics.revenue.view permission
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.permissions (key, label, category) VALUES
  ('analytics.revenue.view', 'View revenue & ARR-impact figures', 'analytics')
ON CONFLICT (key) DO NOTHING;

-- super_admin: enabled. content_reviewer: explicitly disabled (same tight
-- scoping as billing/analytics in 20260720_04).
INSERT INTO public.role_permissions (job_role, permission_key, enabled) VALUES
  ('super_admin',     'analytics.revenue.view', true),
  ('content_reviewer','analytics.revenue.view', false)
ON CONFLICT (job_role, permission_key) DO UPDATE SET enabled = EXCLUDED.enabled;

-- ─────────────────────────────────────────────────────────────────────────────
-- (B1) business_units — mirrors usn-production.public.business_units column-for-
--      column (id, name, slug, type, status, description, activated_at,
--      created_at, updated_at) so the concept lines up across products.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.business_units (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  slug         text NOT NULL UNIQUE,
  type         text,
  status       text NOT NULL DEFAULT 'active',
  description  text,
  activated_at date,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.business_units IS
  'Business-unit anchor, shape-matched to usn-production.public.business_units so a future DEI rollup can union across products. IGY currently holds exactly one row (itself).';

-- Seed IGY as its own business unit. Idempotent on slug.
INSERT INTO public.business_units (name, slug, type, status, description)
VALUES ('It''s God, Yo!', 'igy', 'product', 'active',
        'Daily SMS scripture subscription operated by Deckard Enterprise International, LLC.')
ON CONFLICT (slug) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- (B2) igy_monthly_financials — the subscription-shaped analogue of
--      usn-production.public.usn_monthly_financials. Shared column names
--      (period_year, period_month, gross_revenue_cents, dei_fee_rate,
--      dei_licensing_fee_cents, source, computed_at, notes) are intentional so a
--      DEI ETL can union IGY + USN with minimal mapping. The subscription-native
--      columns (mrr_cents, arr_cents, subscription_gross_cents, addon_gross_cents,
--      active_subscribers) capture IGY's recurring model, which USN (annual
--      sponsor contracts) does not have.
--
--      METRIC DEFINITIONS (kept identical to USN's meaning, per spec Part 4):
--        * gross_revenue_cents  — total gross collected in the period, in cents.
--        * mrr_cents            — monthly recurring revenue at period close.
--        * arr_cents            — annual recurring revenue = mrr_cents * 12.
--        * dei_licensing_fee_cents — DEI management/licensing fee for the period.
--      Populated by a future close-of-period job — NOT written by this migration.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.igy_monthly_financials (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_unit_id         uuid NOT NULL REFERENCES public.business_units(id),
  period_year              integer NOT NULL,
  period_month             integer NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  subscription_gross_cents bigint NOT NULL DEFAULT 0,
  addon_gross_cents        bigint NOT NULL DEFAULT 0,
  gross_revenue_cents      bigint NOT NULL DEFAULT 0,
  mrr_cents                bigint NOT NULL DEFAULT 0,
  arr_cents                bigint NOT NULL DEFAULT 0,
  active_subscribers       integer NOT NULL DEFAULT 0,
  dei_fee_rate             numeric,
  dei_licensing_fee_cents  bigint NOT NULL DEFAULT 0,
  source                   text NOT NULL DEFAULT 'computed',
  computed_at              timestamptz,
  notes                    text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_unit_id, period_year, period_month)
);

COMMENT ON TABLE public.igy_monthly_financials IS
  'Monthly financial rollup for IGY, metric-definition-matched to usn-production.public.usn_monthly_financials for a future DEI cross-product union. Shape only right now — populated by a later close-of-period job, not by this migration.';

CREATE INDEX IF NOT EXISTS idx_igy_monthly_financials_period
  ON public.igy_monthly_financials (period_year, period_month);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: enable on both new tables with NO policies. The admin app reaches these
-- through the service-role client (getSupabaseAdmin), which bypasses RLS; anon
-- and authenticated roles get nothing. Matches the "locked down by default"
-- posture used elsewhere in IGY.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.business_units          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.igy_monthly_financials  ENABLE ROW LEVEL SECURITY;
