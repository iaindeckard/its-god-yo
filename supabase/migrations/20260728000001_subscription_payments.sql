-- =============================================================================
-- subscription_payments — row-level realized-charge ledger (IGY)
--
-- SATISFIES TWO REQUIREMENTS AT ONCE:
--
-- 1) LAUNCH BLOCKER (docs/LAUNCH-CHECKLIST.md). Every realized recurring charge
--    must land here as a row BEFORE IGY takes its first dollar. Mirrors USN's
--    sponsor_payments. Without it the DEI rollup's recomputed_mrr_cents stays NULL
--    forever and the verified/matched/divergent check never turns on — IGY's
--    self-reported MRR would be trusted with nothing cross-checking it. Carries the
--    blocker's minimum: subscription id, invoice/charge/payment-intent ids,
--    gross/fee/net cents, status, period, created_at.
--
-- 2) MULTI-CURRENCY (IGY-DEI-Rollup-Multi-Currency-Architecture-v3-CONFIRMED, Iain
--    2026-07-28). Built currency-agnostic from day one (Canada first, then UK,
--    Spain, others). Every row carries BOTH the presentment pair (what the customer
--    was charged, in any currency) and the Stripe-SETTLED figure (the USD Stripe
--    actually converted it to at settlement). The DEI rollup compares on
--    settled_amount_cents — one field, identical path for USD/CAD/GBP/EUR, NO
--    per-currency branching and NO independent FX table. Settlement mode was
--    empirically verified single-USD (a test-mode CAD 2000 charge settled as
--    balance_transaction.currency=usd, amount=1418, exchange_rate=0.70921, all
--    populated at charge time — so the settled figure is available in the webhook,
--    not deferred to payout).
--
-- SIGNED LEDGER. One row per Stripe balance transaction. kind='charge' rows are
-- POSITIVE inflow; kind='refund'/'dispute' rows are NEGATIVE (Stripe's own signed
-- balance-transaction amount). Net realized revenue for any window =
-- SUM(settled_amount_cents). Refunds/disputes settle at their OWN exchange rate on
-- their OWN date, so they are recorded as their own rows — NEVER derived by
-- subtracting a presentment amount from the original charge.
--
-- GROSS, NOT NET. settled_amount_cents = balance_transaction.amount (gross, before
-- the Stripe fee). Foreign charges bundle an FX margin inside that fee, so gross vs
-- net matters more here than for plain-USD charges — decided deliberately. The fee
-- and post-fee figures are kept alongside (settled_fee_cents / settled_net_cents)
-- for later margin analysis, but the rollup reads gross.
--
-- IDEMPOTENCY. balance_transaction_id is unique — Stripe bt ids are immutable and
-- one-per-settlement, so a redelivered webhook upserts do-nothing.
--
-- RLS: enabled, no policies. Service-role (getSupabaseAdmin) only — same locked-
-- down posture as pending_signups / subscribers / igy_monthly_financials. Written
-- only by the Stripe webhook; populate-forward, immutable.
--
-- NOT IN THIS MIGRATION: the DEI-side recompute/canon/badge logic that consumes
-- this table. That is the next step, after this table exists and is populated.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.subscription_payments (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_unit             text NOT NULL DEFAULT 'igy',   -- rollup discriminator; identical column in USN + cohort tables

  kind                      text NOT NULL
                              CHECK (kind = ANY (ARRAY['charge','refund','dispute'])),

  -- ── Stripe provenance / joins ──────────────────────────────────────────────
  balance_transaction_id    text NOT NULL,                 -- txn_... — the settlement record + idempotency key
  stripe_charge_id          text,                          -- ch_...
  stripe_invoice_id         text,                          -- in_...
  stripe_payment_intent_id  text,                          -- pi_...
  stripe_subscription_id    text,                          -- sub_...  (NULL on refund/dispute rows — not on the charge object)
  stripe_customer_id        text,                          -- cus_...

  -- ── Presentment: what the customer was actually charged, in their currency ──
  -- Signed to match settled (charge +, refund/dispute -). Informational; the
  -- rollup does NOT sum this.
  original_amount_cents     bigint,
  original_currency         text,                          -- lowercase ISO-4217, e.g. 'usd','cad','gbp'

  -- ── Settled: what Stripe converted the charge to at settlement ──────────────
  -- THE CANONICAL field the DEI rollup sums. = balance_transaction.amount, GROSS
  -- (before Stripe fee), signed.
  settled_amount_cents      bigint,                        -- signed gross settled (usually usd)
  settled_currency          text,                          -- captured, never assumed usd
  settled_fee_cents         bigint,                        -- balance_transaction.fee (incl. FX margin on foreign charges)
  settled_net_cents         bigint,                        -- balance_transaction.net (= amount - fee)
  exchange_rate             numeric,                       -- balance_transaction.exchange_rate; NULL when presentment==settlement (USD-native)

  -- ── Context ─────────────────────────────────────────────────────────────────
  billing_reason            text,                          -- invoice.billing_reason (subscription_create|subscription_cycle|...)
  status                    text,                          -- 'paid' | 'refunded' | 'dispute'
  period_start              timestamptz,                   -- invoice.period_start (charge rows)
  period_end                timestamptz,
  stripe_created_at         timestamptz,                   -- balance_transaction.created (authoritative settlement time)
  created_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT subscription_payments_bt_uq UNIQUE (balance_transaction_id)
);

COMMENT ON TABLE public.subscription_payments IS
  'Row-level realized-charge ledger (launch blocker; mirrors USN sponsor_payments). One row per Stripe balance transaction. Signed: charge rows positive, refund/dispute rows negative — net realized revenue = SUM(settled_amount_cents). Each row carries presentment (original_*) + Stripe-settled USD (settled_*) so the DEI rollup recomputes MRR currency-agnostically from settled_amount_cents. Written only by the Stripe webhook; populate-forward, immutable. RLS on, service-role only.';
COMMENT ON COLUMN public.subscription_payments.settled_amount_cents IS
  'CANONICAL field the DEI rollup compares on: gross settled amount (balance_transaction.amount), signed (charge +, refund/dispute -). Usually USD. GROSS, not net — the Stripe fee (incl. FX margin) lives in settled_fee_cents.';
COMMENT ON COLUMN public.subscription_payments.original_currency IS
  'Presentment currency the customer paid in. Currency-agnostic by construction: usd/cad/gbp/eur all flow through this same column, no per-market schema change.';
COMMENT ON COLUMN public.subscription_payments.exchange_rate IS
  'balance_transaction.exchange_rate. NULL when the charge settled in its own currency (USD-native) — a clean "no conversion happened" signal. Kept for audit/reproducibility only; the rollup uses settled_amount_cents, not this rate.';
COMMENT ON COLUMN public.subscription_payments.kind IS
  'charge (positive inflow) | refund | dispute (both negative, own balance transaction + own exchange rate). Never derive a refund by subtracting presentment from the original charge.';

-- The rollup sums by period per business unit; the webhook joins by subscription /
-- customer / invoice.
CREATE INDEX IF NOT EXISTS idx_subscription_payments_bu_created   ON public.subscription_payments (business_unit, stripe_created_at);
CREATE INDEX IF NOT EXISTS idx_subscription_payments_subscription ON public.subscription_payments (stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscription_payments_customer     ON public.subscription_payments (stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_subscription_payments_invoice      ON public.subscription_payments (stripe_invoice_id);

-- RLS: enable, no policies. Service-role only (getSupabaseAdmin bypasses RLS);
-- anon + authenticated get nothing.
ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;

-- ROLLBACK (manual, if ever needed). This migration is purely additive — it
-- creates ONE new table and its own indexes/constraint/comments and touches no
-- existing object, so the revert is a clean single drop with no side effects on
-- any other table. Run the webhook rollback FIRST (stop the writer), then:
--   DROP TABLE IF EXISTS public.subscription_payments CASCADE;
