-- Sponsor program. Specs: IGY-Sponsor-Program-SPEC-LOCKED-2026-07-22.md (display)
-- + IGY-Sponsor-Underwriting-Revenue-LOCKED-2026-07-22.md (revenue).
--
-- Sponsors are faith-aligned orgs who underwrite the site after a private
-- conversation — no public rate card, no self-serve checkout. Equal treatment:
-- every logo is the same size everywhere, no tiers. A sponsor displays (rotator
-- + thank-you page) only while status='active' AND today is within
-- [start_date, end_date]; past end_date it simply drops out — auto-expire by the
-- display query, no manual cleanup / cron needed.
--
-- REVENUE (locked): the actual sponsor payment is a normal Stripe charge on the
-- IGY account, set up manually per sponsor. It is NOT a donation-style
-- pass-through — the donation fund's daily-close already sums all charge/payment
-- balance transactions as gross revenue, so sponsor money counts toward net
-- profit (and the 10% tithe) like subscription revenue. The internal
-- amount_cents / stripe_customer_id / billing_note below are record-keeping for
-- the negotiated deal; they do NOT drive any special revenue path.

CREATE TABLE IF NOT EXISTS public.igy_sponsors (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  logo_url           text NOT NULL,
  contact_email      text,                     -- internal
  start_date         date,                     -- null = no explicit start
  end_date           date,                     -- null = open-ended; past this date the sponsor auto-drops from display
  status             text NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review','active','expired')),
  vetting_notes      text,                     -- internal, never public — same brand-safety concept as tithe charities
  amount_cents       integer,                  -- internal: negotiated amount (record only)
  stripe_customer_id text,                     -- internal: link to the Stripe customer/charge (record only)
  billing_note       text,                     -- internal: one-time vs recurring etc. (structure not yet locked)
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sponsors_status ON public.igy_sponsors (status);

-- Permissions (new 'marketing' category). Managing sponsors is a staff/owner
-- action, not content review.
INSERT INTO public.permissions (key, label, category) VALUES
  ('marketing.sponsors.view',   'View sponsors',                'marketing'),
  ('marketing.sponsors.manage', 'Add/edit/vet/expire sponsors', 'marketing')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (job_role, permission_key, enabled) VALUES
  ('super_admin',      'marketing.sponsors.view',   true),
  ('super_admin',      'marketing.sponsors.manage', true),
  ('content_reviewer', 'marketing.sponsors.view',   false),
  ('content_reviewer', 'marketing.sponsors.manage', false)
ON CONFLICT (job_role, permission_key) DO UPDATE SET enabled = EXCLUDED.enabled;

ALTER TABLE public.igy_sponsors ENABLE ROW LEVEL SECURITY;
