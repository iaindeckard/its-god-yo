-- Cornerstone Partner Program — Stage 1 schema.
-- Spec: cornerstone_partner_program_prompt_v3.md (Google Drive, 2026-08-01).
--
-- Recognizes churches that join during IGY's early growth stage. Pattern-reused
-- from USN's founding_100 / equity_partners shapes (permanent sequential number,
-- recognition-vs-locked-pricing separation, consent-gated public display), copied
-- into IGY's own schema — NO live cross-project reference (USN and IGY are
-- separate Supabase projects per the standing DEI architecture rule).
--
-- KEY DESIGN RULES (from the spec):
--  * A church keeps its permanent Cornerstone Partner number forever, even if it
--    renames, changes admin/contact, resizes, or later loses locked pricing.
--  * cornerstone_status (recognition) and locked_pricing_status (the price lock)
--    are tracked SEPARATELY — a church can stay a Partner while losing the lock.
--  * Numbers are sequential, never reused, assigned only on approval/purchase,
--    and unaffected by later deletes/cancellations (a Postgres SEQUENCE gives all
--    of this for free — gaps are fine, values never recycle).
--  * The permanent number cannot be silently edited once assigned (guard trigger;
--    a protected correction path can override via a session GUC and is auditable).
--  * Manual approval at launch, flip to auto later — a CONFIG change, not a
--    redeploy (cornerstone_config.auto_approval_enabled, default false).
--
-- All tables: RLS enabled, service-role only (no policies) — same posture as every
-- other IGY table. Server code reaches them through the service-role admin client.

-- ---------------------------------------------------------------------------
-- Permanent, never-reused partner numbering.
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.cornerstone_partner_seq AS integer START WITH 1 MINVALUE 1;

-- ---------------------------------------------------------------------------
-- churches — the org entity. Survives name/contact/size changes; the partner
-- record (below) hangs off this, so the number is never tied to mutable details.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.churches (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                        text NOT NULL,
  slug                        text,
  website                     text,
  address                     text,
  city                        text,
  state_province              text,
  postal_code                 text,
  country                     text,
  denomination                text,
  estimated_attendance        integer,
  estimated_youth_group_size  integer,
  logo_url                    text,        -- internal storage ref; shown publicly only with logo_display_opt_in
  public_recognition_opt_in   boolean NOT NULL DEFAULT false,
  logo_display_opt_in         boolean NOT NULL DEFAULT false,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_churches_slug ON public.churches (slug) WHERE slug IS NOT NULL;

-- ---------------------------------------------------------------------------
-- cornerstone_applications — the review workflow. Full lifecycle status lives
-- here; internal_notes are staff-only and MUST NOT be shown to the church.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cornerstone_applications (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id                uuid NOT NULL REFERENCES public.churches (id) ON DELETE CASCADE,
  applicant_user_id        uuid,            -- optional: an existing IGY Supabase user, if any
  contact_name             text,
  contact_title            text,
  contact_email            text,
  contact_phone            text,
  preferred_plan           text,
  status                   text NOT NULL DEFAULT 'submitted'
                             CHECK (status IN ('draft','submitted','under_review','approved',
                                               'awaiting_payment','active','inactive','declined','cancelled')),
  submitted_at             timestamptz DEFAULT now(),
  reviewed_at              timestamptz,
  reviewed_by              uuid,            -- staff_members.user_id
  internal_notes           text,            -- staff-only, never church-visible
  terms_version_accepted   text,
  authorization_confirmed  boolean NOT NULL DEFAULT false,
  source_campaign          text,            -- attribution: 'episcopal' | 'hardtner' | other code
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cornerstone_apps_status ON public.cornerstone_applications (status);
CREATE INDEX IF NOT EXISTS idx_cornerstone_apps_church ON public.cornerstone_applications (church_id);

-- ---------------------------------------------------------------------------
-- cornerstone_partners — the permanent recognition record. Created at approval;
-- partner_number is assigned then and is immutable thereafter (guard trigger).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cornerstone_partners (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id                     uuid NOT NULL UNIQUE REFERENCES public.churches (id) ON DELETE CASCADE,
  application_id                uuid REFERENCES public.cornerstone_applications (id) ON DELETE SET NULL,
  partner_number                integer NOT NULL UNIQUE,           -- from cornerstone_partner_seq; permanent, never reused
  cornerstone_status            text NOT NULL DEFAULT 'active'
                                  CHECK (cornerstone_status IN ('active','inactive','revoked')),
  recognition_date              date NOT NULL DEFAULT current_date,
  activation_date               date,
  inactive_date                 date,
  public_listing_status         text NOT NULL DEFAULT 'private'
                                  CHECK (public_listing_status IN ('private','listed')),
  original_qualifying_plan      text,
  original_qualifying_price_cents integer,
  locked_pricing_status         text NOT NULL DEFAULT 'none'
                                  CHECK (locked_pricing_status IN ('none','active','suspended','expired')),
  locked_pricing_terms          jsonb NOT NULL DEFAULT '{}'::jsonb,
  early_access_eligible         boolean NOT NULL DEFAULT true,
  stripe_customer_id            text,
  stripe_subscription_id        text,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cornerstone_partners_status ON public.cornerstone_partners (cornerstone_status);
CREATE INDEX IF NOT EXISTS idx_cornerstone_partners_listing ON public.cornerstone_partners (public_listing_status);

-- Immutable partner_number guard. Blocks any change to an already-assigned number
-- unless the session explicitly opts into the protected correction path via
--   SET LOCAL cornerstone.allow_number_correction = 'on';
-- (the correction itself is expected to be written to cornerstone_audit_log).
CREATE OR REPLACE FUNCTION public.cornerstone_guard_partner_number()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.partner_number IS NOT NULL
     AND NEW.partner_number IS DISTINCT FROM OLD.partner_number
     AND current_setting('cornerstone.allow_number_correction', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'cornerstone partner_number is permanent and cannot be changed (partner %, % -> %)',
      OLD.id, OLD.partner_number, NEW.partner_number
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cornerstone_guard_partner_number ON public.cornerstone_partners;
CREATE TRIGGER trg_cornerstone_guard_partner_number
  BEFORE UPDATE ON public.cornerstone_partners
  FOR EACH ROW EXECUTE FUNCTION public.cornerstone_guard_partner_number();

-- ---------------------------------------------------------------------------
-- cornerstone_config — single-row admin config. Drives launch behavior WITHOUT a
-- redeploy: manual_approval_required=true / auto_approval_enabled=false at launch,
-- flipped later once volume/quality are trusted.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cornerstone_config (
  id                         boolean PRIMARY KEY DEFAULT true CHECK (id),   -- enforces exactly one row
  program_active             boolean NOT NULL DEFAULT false,
  enrollment_opens_at        timestamptz,
  enrollment_closes_at       timestamptz,
  eligible_plans             jsonb NOT NULL DEFAULT '[]'::jsonb,
  auto_approval_enabled      boolean NOT NULL DEFAULT false,
  manual_approval_required   boolean NOT NULL DEFAULT true,
  pricing_lock_rules         jsonb NOT NULL DEFAULT '{}'::jsonb,
  public_recognition_default boolean NOT NULL DEFAULT false,
  terms_version              text NOT NULL DEFAULT 'v1-draft',
  certificate_scripture      text,          -- optional scripture reference printed on the certificate
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  updated_by                 uuid
);
INSERT INTO public.cornerstone_config (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- cornerstone_audit_log — significant changes (approvals, declines, status
-- flips, number corrections, locked-pricing changes).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cornerstone_audit_log (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  partner_id     uuid REFERENCES public.cornerstone_partners (id) ON DELETE SET NULL,
  application_id uuid REFERENCES public.cornerstone_applications (id) ON DELETE SET NULL,
  action         text NOT NULL,
  old_value      jsonb,
  new_value      jsonb,
  performed_by   uuid,
  reason         text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cornerstone_audit_partner ON public.cornerstone_audit_log (partner_id);

-- ---------------------------------------------------------------------------
-- RBAC. New 'partners' category, mirroring the sponsors view/manage pattern plus
-- a dedicated review (approve/decline) grant.
-- ---------------------------------------------------------------------------
INSERT INTO public.permissions (key, label, category) VALUES
  ('partners.view',   'View Cornerstone applications & partners', 'partners'),
  ('partners.review', 'Approve/decline Cornerstone applications',  'partners'),
  ('partners.manage', 'Manage partner records, pricing & config',  'partners')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (job_role, permission_key, enabled) VALUES
  ('super_admin',      'partners.view',   true),
  ('super_admin',      'partners.review', true),
  ('super_admin',      'partners.manage', true),
  ('content_reviewer', 'partners.view',   false),
  ('content_reviewer', 'partners.review', false),
  ('content_reviewer', 'partners.manage', false)
ON CONFLICT (job_role, permission_key) DO UPDATE SET enabled = EXCLUDED.enabled;

-- ---------------------------------------------------------------------------
-- Lock everything down (service-role only, no policies).
-- ---------------------------------------------------------------------------
ALTER TABLE public.churches                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cornerstone_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cornerstone_partners     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cornerstone_config       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cornerstone_audit_log    ENABLE ROW LEVEL SECURITY;
