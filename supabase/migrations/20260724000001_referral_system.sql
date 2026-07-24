-- Referral system (Option B): purpose-built attribution + reward tracking that
-- reuses Stripe's customer-balance credit as the reward primitive. Give-a-month /
-- get-a-month, two-sided, propagating (a referred party gets their own code once
-- they convert). Reward = customer-balance credit (NOT a coupon), scales to the
-- owner's actual plan price (families and churches use the same mechanic). Cap:
-- max 6 referrer rewards per rolling trailing-12-months. Reward fires on the
-- referee's PAID conversion (first real invoice), and is clawed back if that
-- payment is later refunded/charged back. Mutually exclusive with promo codes.
--
-- Posture matches pending_signups / consent_log: RLS enabled, NO policies =>
-- service-role only. All reads/writes go through server code (lib/referral.ts +
-- the Stripe webhook), never the client.

-- ── One shareable code per participant (referrer, and each referee once they
--    convert — that's the propagation loop). ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.referral_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_customer_id text NOT NULL,               -- Stripe customer (cus_...)
  owner_kind text NOT NULL CHECK (owner_kind = ANY (ARRAY['family','church'])),
  code text NOT NULL UNIQUE,                      -- customer-facing, friendly
  active boolean NOT NULL DEFAULT true,           -- deactivated on clawback / retire
  created_at timestamptz NOT NULL DEFAULT now()
);
-- At most one ACTIVE code per owner (re-mint after deactivation is allowed).
CREATE UNIQUE INDEX IF NOT EXISTS referral_codes_one_active_per_owner
  ON public.referral_codes (owner_customer_id) WHERE active;
ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;
-- No policies: service-role only.

-- ── Attribution ledger: one row per referred signup. Carries the Stripe IDs of
--    the referee's converting payment so a later refund/chargeback can be matched
--    back and reversed. ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.referral_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_code_id uuid NOT NULL REFERENCES public.referral_codes(id),
  referrer_customer_id text NOT NULL,
  referee_pending_signup_id uuid NOT NULL UNIQUE REFERENCES public.pending_signups(id),
  referee_customer_id text,
  -- Stripe IDs of the referee's first real (paid) invoice — set at conversion,
  -- used to match refund/dispute webhooks back to this event for clawback.
  referee_invoice_id text,
  referee_charge_id text,
  referee_payment_intent_id text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status = ANY (ARRAY['pending','converted','rewarded','capped','void'])),
  referee_credit_applied_at timestamptz,         -- give-a-month applied (first invoice)
  referrer_credit_applied_at timestamptz,        -- get-a-month applied (on conversion)
  reversed_at timestamptz,                        -- set when a clawback reverses this
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS referral_events_referrer ON public.referral_events (referrer_customer_id);
CREATE INDEX IF NOT EXISTS referral_events_referee_customer ON public.referral_events (referee_customer_id);
CREATE INDEX IF NOT EXISTS referral_events_status ON public.referral_events (status);
-- Clawback matching by the converting payment's Stripe IDs.
CREATE INDEX IF NOT EXISTS referral_events_charge ON public.referral_events (referee_charge_id);
CREATE INDEX IF NOT EXISTS referral_events_payment_intent ON public.referral_events (referee_payment_intent_id);
ALTER TABLE public.referral_events ENABLE ROW LEVEL SECURITY;
-- No policies: service-role only.

-- ── Reward ledger: source of truth for the rolling-12-month cap. Net granted
--    months for an owner = count(grant) - count(reversal) in the trailing 365d.
--    A separate row per grant and per reversal keeps the cap math auditable. ───
CREATE TABLE IF NOT EXISTS public.referral_reward_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_customer_id text NOT NULL,               -- the referrer being credited/debited
  referral_event_id uuid NOT NULL REFERENCES public.referral_events(id),
  credit_cents integer NOT NULL,                 -- magnitude of the month credit (positive)
  direction text NOT NULL CHECK (direction = ANY (ARRAY['grant','reversal'])),
  granted_at timestamptz NOT NULL DEFAULT now()
);
-- Rolling-window cap query: WHERE owner_customer_id = $1 AND granted_at >= now() - interval '365 days'
CREATE INDEX IF NOT EXISTS referral_reward_ledger_owner_time
  ON public.referral_reward_ledger (owner_customer_id, granted_at);
ALTER TABLE public.referral_reward_ledger ENABLE ROW LEVEL SECURITY;
-- No policies: service-role only.
