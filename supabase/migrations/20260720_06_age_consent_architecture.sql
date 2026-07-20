-- Age-aware, country-configurable consent architecture.
--
-- FAIL-SAFE BY DESIGN: age_consent_thresholds is the single source of truth for
-- the self-consent age of each country. Every row starts attorney_confirmed=false
-- at the strictest plausible threshold (16, the GDPR ceiling). Until counsel
-- confirms a country's row, the signup path blocks anyone computed under 16 in
-- that country. NOTHING here assumes a real number for any country — not even
-- US/COPPA's 13 — because that is exactly the kind of guess this table exists to
-- prevent. Only Iain-provided, attorney-confirmed values may flip a row.

CREATE TABLE IF NOT EXISTS public.age_consent_thresholds (
  country_code text PRIMARY KEY,                              -- ISO 3166-1 alpha-2
  minimum_age_for_self_consent integer NOT NULL DEFAULT 16,  -- strictest plausible default
  attorney_confirmed boolean NOT NULL DEFAULT false,
  attorney_confirmed_at timestamptz,
  attorney_confirmed_by text,
  required_consent_mechanism text,                           -- e.g. 'verifiable_parental_consent_v1' once confirmed
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Lock to service role only (config that gates legal compliance): RLS on, no
-- policies. The service role bypasses RLS; anon/authenticated get nothing.
ALTER TABLE public.age_consent_thresholds ENABLE ROW LEVEL SECURITY;

-- Seed the two active launch countries — UNCONFIRMED, strictest default.
-- Do NOT add attorney_confirmed=true rows here; that requires explicit
-- Iain/counsel confirmation and happens via the admin UI, not a migration.
INSERT INTO public.age_consent_thresholds (country_code, minimum_age_for_self_consent, attorney_confirmed, notes) VALUES
  ('US', 16, false, 'Fail-safe default (16) pending counsel. US COPPA references 13 but is NOT confirmed here — do not assume.'),
  ('MX', 16, false, 'Fail-safe default (16) pending counsel. Mexico rules not yet researched.')
ON CONFLICT (country_code) DO NOTHING;

-- Birth YEAR only (minimal data) + derived audit fields on each recipient's
-- consent row. age_gate_decision records which branch the gate took so the
-- enhanced-consent path is never silently conflated with the standard one.
ALTER TABLE public.consent_log
  ADD COLUMN IF NOT EXISTS recipient_birth_year integer,
  ADD COLUMN IF NOT EXISTS recipient_country_code text,
  ADD COLUMN IF NOT EXISTS age_gate_decision text;  -- 'standard' | 'enhanced_pending_mechanism'

-- Dedicated permission for managing thresholds (admin category).
INSERT INTO public.permissions (key, label, category) VALUES
  ('admin.consent_thresholds.manage', 'Manage age-consent thresholds', 'admin')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (job_role, permission_key, enabled) VALUES
  ('super_admin',      'admin.consent_thresholds.manage', true),
  ('content_reviewer', 'admin.consent_thresholds.manage', false)
ON CONFLICT (job_role, permission_key) DO UPDATE SET enabled = EXCLUDED.enabled;
