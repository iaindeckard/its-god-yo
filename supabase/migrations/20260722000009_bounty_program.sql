-- Translation/reword error bounty program.
-- Specs: IGY-Translation-Bounty-SPEC-LOCKED-2026-07-22.md +
--        IGY-Translation-Bounty-Credit-Mechanism-CORRECTED-2026-07-22.md.
--
-- CORRECTED mechanism: the $6.99 reward is an INTERNAL credit ledger in IGY's
-- own DB — NOT a Stripe customer balance, no Stripe API calls. It mirrors the
-- donation fund's "earn into a ledger, a human manually applies it later"
-- pattern: a confirmed error EARNS a credit; applying it toward a bill is a
-- deliberate manual admin action. Nothing pays automatically.
--
-- Flow: subscriber reports an issue -> reports on the same verse/date/track are
-- grouped -> an admin confirms or rejects each group (human review, the primary
-- anti-gaming safeguard) -> on confirm, ONLY the earliest-timestamped reporter
-- earns a credit, subject to a cap of 1 rewarded report per person per calendar
-- month, enforced AT ISSUANCE (people may report freely).

-- ─────────────────────────────────────────────────────────────────────────────
-- igy_error_reports — one row per submitted report. group_key is deterministic
-- (theme_track|report_date|verse_ref) so reports on the same underlying issue
-- cluster together for review ("grouped_with" in the spec).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.igy_error_reports (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_email            text NOT NULL,
  reporter_stripe_customer_id text,                 -- resolved if the reporter is a known customer (future redemption)
  verse_ref                 text NOT NULL,
  theme_track               text NOT NULL DEFAULT 'general' REFERENCES public.theme_tracks(key),
  report_date               date NOT NULL,          -- the date of the daily text being reported
  reported_text             text,                   -- the specific text they think is wrong (optional)
  description               text NOT NULL,          -- free-text: what's wrong
  group_key                 text NOT NULL,          -- theme_track|report_date|verse_ref
  submitted_at              timestamptz NOT NULL DEFAULT now(),
  status                    text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected')),
  reviewed_by               uuid,
  reviewed_at               timestamptz,
  review_note               text,
  created_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_error_reports_group ON public.igy_error_reports (group_key, submitted_at);
CREATE INDEX IF NOT EXISTS idx_error_reports_status ON public.igy_error_reports (status);

-- ─────────────────────────────────────────────────────────────────────────────
-- igy_bounty_credits — the internal credit ledger. A confirmed error earns one
-- $6.99 credit for the winning reporter. status 'earned' = an unredeemed
-- balance; 'applied' = manually redeemed by an admin (applied_at/applied_by).
-- credit_month (first-of-month) makes the per-person monthly cap a cheap lookup.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.igy_bounty_credits (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id                 uuid NOT NULL REFERENCES public.igy_error_reports(id),
  reporter_email            text NOT NULL,
  reporter_stripe_customer_id text,
  amount_cents              integer NOT NULL DEFAULT 699,   -- $6.99 flat (Individual monthly rate)
  status                    text NOT NULL DEFAULT 'earned' CHECK (status IN ('earned','applied','expired')),
  issued_at                 timestamptz NOT NULL DEFAULT now(),
  issued_by                 uuid,
  credit_month              date NOT NULL,                  -- first-of-month of issuance (cap key)
  applied_at                timestamptz,
  applied_by                uuid,
  applied_note              text,
  created_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bounty_credits_reporter_month ON public.igy_bounty_credits (reporter_email, credit_month);
CREATE INDEX IF NOT EXISTS idx_bounty_credits_status ON public.igy_bounty_credits (status);
-- One rewarded credit per report at most.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bounty_credit_report ON public.igy_bounty_credits (report_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Permissions. Confirming an error report is content review (content_reviewer
-- may do it). Applying a credit toward a real bill is a financial redemption —
-- super_admin only.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.permissions (key, label, category) VALUES
  ('finance.bounty.view',   'View error-bounty reports & credit ledger', 'finance'),
  ('finance.bounty.review', 'Confirm/reject error-bounty reports',        'finance'),
  ('finance.bounty.apply',  'Manually apply an earned bounty credit',     'finance')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (job_role, permission_key, enabled) VALUES
  ('super_admin',      'finance.bounty.view',   true),
  ('super_admin',      'finance.bounty.review', true),
  ('super_admin',      'finance.bounty.apply',  true),
  ('content_reviewer', 'finance.bounty.view',   true),
  ('content_reviewer', 'finance.bounty.review', true),
  ('content_reviewer', 'finance.bounty.apply',  false)
ON CONFLICT (job_role, permission_key) DO UPDATE SET enabled = EXCLUDED.enabled;

ALTER TABLE public.igy_error_reports  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.igy_bounty_credits ENABLE ROW LEVEL SECURITY;
