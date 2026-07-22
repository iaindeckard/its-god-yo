-- Tithe / Donation Fund Ledger (spec: IGY-Tithe-Donation-Fund-Ledger-SPEC-v2-2026-07-22).
--
-- IGY commits 10% of daily NET PROFIT to a reserved donation fund. LEDGER ONLY —
-- no physical account movement; the reserve is tracked in the database. A daily
-- close-of-business job computes that day's net profit from EXACT inputs (Stripe
-- fees, a precise daily share of known flat recurring costs, real Twilio usage)
-- plus any one-time/irregular costs booked on their actual day, adds 10% of a
-- positive net to the reserve, and NEVER subtracts on a loss day. Manual
-- disbursements decrement the reserve.
--
-- Schema pattern deliberately mirrors USN's mission_fund_ledger +
-- usn_financial_periods where reasonable (proven infrastructure), but the
-- charities/lists are intentionally separate, so these are IGY-specific tables.
-- Everything ties to the IGY business_unit for future DEI rollup readiness.

-- ─────────────────────────────────────────────────────────────────────────────
-- Permissions (new 'finance' category)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.permissions (key, label, category) VALUES
  ('finance.donation_fund.view',     'View the donation fund ledger & balance', 'finance'),
  ('finance.donation_fund.disburse', 'Record a donation disbursement',          'finance')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (job_role, permission_key, enabled) VALUES
  ('super_admin',      'finance.donation_fund.view',     true),
  ('super_admin',      'finance.donation_fund.disburse', true),
  ('content_reviewer', 'finance.donation_fund.view',     false),
  ('content_reviewer', 'finance.donation_fund.disburse', false)
ON CONFLICT (job_role, permission_key) DO UPDATE SET enabled = EXCLUDED.enabled;

-- ─────────────────────────────────────────────────────────────────────────────
-- Flat recurring costs — known fixed subscriptions. The daily job takes each
-- active row's amount and divides by the actual number of days in that period
-- (month or year) for an EXACT daily allocation — not an estimate.
--   source: 'confirmed'          — the real value, verified from the account
--           'needs_confirmation' — a stand-in until Iain supplies the real number
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.igy_recurring_costs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor          text NOT NULL,
  description     text,
  amount_cents    bigint NOT NULL DEFAULT 0,          -- per one period of `cadence`
  cadence         text NOT NULL CHECK (cadence IN ('monthly','annual')),
  active          boolean NOT NULL DEFAULT true,
  effective_start date NOT NULL DEFAULT CURRENT_DATE,
  effective_end   date,                               -- null = ongoing
  source          text NOT NULL DEFAULT 'confirmed',
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.igy_recurring_costs IS
  'Known flat recurring costs for IGY. Daily job allocates amount_cents / (days in the target period) per active row. Values gathered from real accounts 2026-07-22; domain amount flagged needs_confirmation.';

-- Seed with the REAL current costs gathered 2026-07-22:
--   Vercel Hobby = $0/mo (free; once-daily cron cap confirms Hobby)
--   GitHub Free  = $0/mo (unlimited private repos on Free; single private repo)
--   Domain itsgodyo.com — GoDaddy, registered 2026-07-20 for a 2-year term. The
--     exact dollar amount is NOT API-retrievable; seeded at a standard GoDaddy
--     .com annual rate as a stand-in, flagged needs_confirmation for Iain.
INSERT INTO public.igy_recurring_costs (vendor, description, amount_cents, cadence, source, notes, effective_start) VALUES
  ('Vercel', 'Hosting — Hobby plan (free tier)',            0,    'monthly', 'confirmed',
     'Hobby plan is free; the once-per-day cron cap corroborates Hobby. Revisit if upgraded to Pro ($20/mo).', DATE '2026-07-20'),
  ('GitHub', 'Source hosting — Free plan',                  0,    'monthly', 'confirmed',
     'GitHub Free includes unlimited private repos; IGY uses a single private repo, no org/team features.', DATE '2026-07-20'),
  ('GoDaddy','Domain registration — itsgodyo.com (.com)',   1999, 'annual',  'needs_confirmation',
     '2-year registration 2026-07-20 -> 2028-07-20. $19.99/yr is a standard GoDaddy .com rate placeholder; replace with the real receipt amount (annualized).', DATE '2026-07-20')
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- SMS usage log — one row per message actually SENT, capturing the real
-- per-segment price AT SEND TIME so historical Twilio cost is exact even if
-- pricing later changes. Empty until Twilio is switched on (currently inert);
-- the daily job sums cost_cents for the target day (0 today = accurate).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.igy_sms_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_sid       text,
  direction         text NOT NULL DEFAULT 'outbound',
  segments          integer NOT NULL DEFAULT 1,
  unit_price_cents  numeric NOT NULL DEFAULT 0,   -- per-segment price at send time
  carrier_fee_cents numeric NOT NULL DEFAULT 0,   -- carrier pass-through, per message
  cost_cents        numeric NOT NULL DEFAULT 0,   -- segments*unit_price + carrier_fee (exact)
  sent_on           date NOT NULL DEFAULT CURRENT_DATE,
  sent_at           timestamptz NOT NULL DEFAULT now(),
  pending_signup_id uuid,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_igy_sms_log_sent_on ON public.igy_sms_log (sent_on);

COMMENT ON TABLE public.igy_sms_log IS
  'Per-message Twilio send log for EXACT daily SMS cost. cost_cents captured at send time. Empty until Twilio goes live; wiring the submit-consent/inbound send to write here is a follow-up.';

-- ─────────────────────────────────────────────────────────────────────────────
-- One-time / irregular costs — booked on the actual day incurred (no proration).
-- The rare case that may be estimated + trued-up later (is_estimate).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.igy_one_time_costs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incurred_on  date NOT NULL,
  vendor       text,
  category     text,
  description  text,
  amount_cents bigint NOT NULL,
  is_estimate  boolean NOT NULL DEFAULT false,
  entered_by   text,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_igy_one_time_costs_incurred_on ON public.igy_one_time_costs (incurred_on);

-- ─────────────────────────────────────────────────────────────────────────────
-- Daily donation-fund ledger — one row per business day close. Idempotent on
-- (business_unit_id, entry_date): re-running a day recomputes that row.
-- reserved_balance_after_cents is the ACCRUED running total of tithe at that
-- close (audit snapshot); the live available balance is accrued − disbursed,
-- computed at read time so later disbursements are always reflected.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.igy_donation_fund_ledger (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_unit_id              uuid NOT NULL REFERENCES public.business_units(id),
  entry_date                    date NOT NULL,
  gross_revenue_cents           bigint NOT NULL DEFAULT 0,
  stripe_fees_cents             bigint NOT NULL DEFAULT 0,
  recurring_costs_cents         bigint NOT NULL DEFAULT 0,
  twilio_cost_cents             bigint NOT NULL DEFAULT 0,
  one_time_costs_cents          bigint NOT NULL DEFAULT 0,
  net_profit_cents              bigint NOT NULL DEFAULT 0,   -- may be negative
  tithe_rate                    numeric NOT NULL DEFAULT 0.10,
  tithe_cents                   bigint NOT NULL DEFAULT 0,   -- max(0, round(rate*net))
  reserved_balance_after_cents  bigint NOT NULL DEFAULT 0,   -- accrued snapshot
  entry_type                    text NOT NULL DEFAULT 'daily_close', -- | 'true_up'
  true_up_of                    uuid REFERENCES public.igy_donation_fund_ledger(id),
  source                        text NOT NULL DEFAULT 'computed',
  computed_at                   timestamptz,
  notes                         text,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_unit_id, entry_date)
);
CREATE INDEX IF NOT EXISTS idx_igy_donation_ledger_date ON public.igy_donation_fund_ledger (entry_date);

-- ─────────────────────────────────────────────────────────────────────────────
-- Manual disbursements — recorded when Iain actually donates. Decrements the
-- reserved balance (available = accrued tithe − disbursed).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.igy_donation_disbursements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_unit_id uuid NOT NULL REFERENCES public.business_units(id),
  disbursed_on     date NOT NULL DEFAULT CURRENT_DATE,
  charity_name     text NOT NULL,
  amount_cents     bigint NOT NULL CHECK (amount_cents > 0),
  reference        text,
  triggered_by     text,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_igy_disbursements_date ON public.igy_donation_disbursements (disbursed_on);

-- RLS: enable on all five, no policies. Admin app uses the service-role client
-- (bypasses RLS); anon/authenticated get nothing.
ALTER TABLE public.igy_recurring_costs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.igy_sms_log                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.igy_one_time_costs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.igy_donation_fund_ledger    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.igy_donation_disbursements  ENABLE ROW LEVEL SECURITY;
