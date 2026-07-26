-- =============================================================================
-- Cohort-safe subscription history + project revenue anchor (IGY)
-- Approved shape: two tables (subscribers + subscriber_monthly_revenue) plus the
-- singleton first-paid anchor. Schema is deliberately identical to the USN copy
-- (business_unit-tagged) so the future DEI rollup computes NRR per business unit
-- and UNIONs, rather than translating between two shapes.
--
-- WHY THIS EXISTS (the expensive-later problem): none of this is reconstructable
-- from current Stripe state after a customer upgrades/cancels. It must be written
-- as it happens and never recomputed. All three tables are populate-forward only.
--
-- KEY DECISION — NORMALIZED MRR, NOT CASH.
-- IGY is majority-annual (individual_annual $59, family_annual $99, gift_annual
-- $59, and all three group tiers are annual; only individual_monthly $6.99 and
-- dm_addon_monthly $1.99 bill monthly). Writing cash on invoice.paid would post
-- one big month and eleven zeros, making NRR and FIP §2 ARR (= MRR × 12) garbage.
-- So the monthly snapshot stores NORMALIZED monthly recurring revenue:
--   mrr_cents = round( SUM over active subscription items of
--                        unit_amount * quantity / (interval = 'year' ? 12 : 1) )
-- e.g. a $59/yr sub records 492 cents EVERY active month; family $99/yr → 825;
-- group $28/yr/teen × N teens → round(2800 * N / 12). Group MRR is the full plan
-- value (unit × quantity), never per-seat. Cash actually collected is kept
-- separately in cash_collected_cents — useful, but NOT what NRR reads.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- (1) subscribers — one durable row per Stripe customer (the BILLING entity).
--     For gift_annual the billing entity is the PURCHASER, not the recipient
--     (the recipient only exists as a consent_log phone); NRR follows whoever
--     renews/churns, which is the purchaser. This table is the home for both the
--     cohort anchor (first_paid_month) and subscriber country.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.subscribers (
  stripe_customer_id  text PRIMARY KEY,                 -- cus_...
  business_unit       text NOT NULL DEFAULT 'igy',      -- rollup discriminator; identical column in USN
  country             text,                             -- ISO-3166-1 alpha-2. NULLABLE: IGY checkout collects
                                                         --   no billing address, so this is sourced from the saved
                                                         --   payment_method.card.country (issuing country), best-effort.
  first_paid_at       timestamptz,                      -- first PAID invoice for this customer (cohort anchor)
  -- Generated, stored, immutable. NOTE: the bare date_trunc('month', first_paid_at)
  -- from the spec is STABLE (session-tz dependent) and Postgres rejects non-immutable
  -- generation expressions, so we anchor to UTC to make it IMMUTABLE + deterministic.
  first_paid_month    date GENERATED ALWAYS AS ((date_trunc('month', (first_paid_at AT TIME ZONE 'UTC')))::date) STORED,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.subscribers IS
  'Durable per-Stripe-customer record. For gift plans the row is the PURCHASER (billing entity), not the SMS recipient. Home for the cohort anchor (first_paid_month) and subscriber country. Populate-forward only.';
COMMENT ON COLUMN public.subscribers.country IS
  'Nullable. IGY checkout does not collect a billing address; populate from payment_method.card.country at signup.';

CREATE INDEX IF NOT EXISTS idx_subscribers_first_paid_month ON public.subscribers (business_unit, first_paid_month);
CREATE INDEX IF NOT EXISTS idx_subscribers_country          ON public.subscribers (business_unit, country);

-- ─────────────────────────────────────────────────────────────────────────────
-- (2) subscriber_monthly_revenue — one LIVE row per (customer, month), written by
--     a month-end snapshot job. INVARIANT: a row is written every month for every
--     customer with first_paid_at set, INCLUDING a mrr_cents = 0 row when they have
--     fully churned. A 0 row is an explicit churn signal; an ABSENT row means the
--     snapshot has not run — never "zero revenue". This makes NRR able to tell
--     "churned" from "we didn't write a row".
--
--     Rows are immutable once written. Money coming back (refund/chargeback) does
--     NOT mutate a row — instead a corrected row is inserted and the prior row is
--     marked superseded_by it. The live view is WHERE superseded_at IS NULL.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.subscriber_monthly_revenue (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_unit         text NOT NULL DEFAULT 'igy',
  stripe_customer_id    text NOT NULL REFERENCES public.subscribers(stripe_customer_id),
  period_month          date NOT NULL,                  -- first-of-month (e.g. 2026-08-01)
  mrr_cents             bigint NOT NULL DEFAULT 0,       -- NORMALIZED monthly recurring revenue (see header). What NRR reads.
  cash_collected_cents  bigint NOT NULL DEFAULT 0,       -- actual cash booked this month. NOT what NRR reads.
  plan_key              text,                            -- dominant plan at snapshot (individual_annual, family_annual, ...)
  snapshot_at           timestamptz,                     -- when the month-end snapshot computed this (as-of last day of month)
  written_at            timestamptz NOT NULL DEFAULT now(),
  -- Correction chain (refunds / chargebacks): never mutate; supersede.
  superseded_at         timestamptz,
  superseded_by         uuid REFERENCES public.subscriber_monthly_revenue(id),
  correction_reason     text                             -- e.g. 'refund', 'chargeback', 'restatement'
);

-- Exactly one LIVE row per customer-month; superseded rows are exempt so the
-- correction chain can coexist with the original.
CREATE UNIQUE INDEX IF NOT EXISTS uq_smr_live_customer_month
  ON public.subscriber_monthly_revenue (business_unit, stripe_customer_id, period_month)
  WHERE superseded_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_smr_period ON public.subscriber_monthly_revenue (business_unit, period_month) WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_smr_customer ON public.subscriber_monthly_revenue (stripe_customer_id);

COMMENT ON TABLE public.subscriber_monthly_revenue IS
  'Month-end NORMALIZED MRR snapshot, one live row per (customer, month), zero-row for churned. Immutable; corrections supersede via superseded_by, never mutate. mrr_cents is what NRR/ARR read; cash_collected_cents is booked cash.';

-- ─────────────────────────────────────────────────────────────────────────────
-- (3) project_revenue_anchor — SINGLETON: the single earliest PAID invoice across
--     the whole project. Anchors a five-year clock that cannot be reconstructed
--     later. Provisional for 30 days against refund: if the anchoring invoice is
--     refunded inside that window, this row is SUPERSEDED by the next-earliest
--     paid invoice (never overwritten). After 30 days with no refund it is
--     confirmed and locked. A partial unique index enforces exactly one live row
--     per business unit.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.project_revenue_anchor (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_unit             text NOT NULL DEFAULT 'igy',
  stripe_customer_id        text NOT NULL,
  stripe_invoice_id         text NOT NULL,
  stripe_payment_intent_id  text,
  first_paid_at             timestamptz NOT NULL,        -- the instant the five-year clock starts from
  amount_cents              bigint,
  provisional_until         timestamptz NOT NULL,        -- writer sets = first_paid_at + interval '30 days'
  confirmed                 boolean NOT NULL DEFAULT false, -- flips true after provisional_until passes with no refund
  superseded_at             timestamptz,
  superseded_by             uuid REFERENCES public.project_revenue_anchor(id),
  superseded_reason         text,                        -- e.g. 'anchor invoice refunded within 30d'
  created_at                timestamptz NOT NULL DEFAULT now()
);

-- Exactly one LIVE anchor per business unit.
CREATE UNIQUE INDEX IF NOT EXISTS uq_revenue_anchor_live
  ON public.project_revenue_anchor (business_unit)
  WHERE superseded_at IS NULL;

COMMENT ON TABLE public.project_revenue_anchor IS
  'Singleton earliest-paid-invoice anchor per business unit; provisional 30 days against refund, then confirmed and locked. Never overwritten — corrections supersede. Anchors the five-year clock.';

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: enable, no policies. Service-role (getSupabaseAdmin) only — same locked-
-- down posture as pending_signups / igy_monthly_financials. Anon + authenticated
-- get nothing.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.subscribers                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriber_monthly_revenue  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_revenue_anchor      ENABLE ROW LEVEL SECURITY;
