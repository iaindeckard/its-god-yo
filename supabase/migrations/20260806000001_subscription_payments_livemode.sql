-- Task 2: give subscription_payments a test/live discriminator so test-clock
-- artifacts can never inflate the DEI rollup.
--
-- The table had NO livemode/is_test column, so the 35 test-clock charge rows
-- (Aug 2-3 2026, $6,075.96, all test-mode in Stripe) were indistinguishable from
-- real revenue. We add `livemode` (Stripe's own signal), backfill the existing
-- rows to false (they are ALL test-clock — confirmed: the only rows in the table,
-- all Aug 2-3, their balance transactions exist only in Stripe test mode), and
-- default new rows to true. Going forward lib/subscriptionPayments.buildPaymentRow
-- stamps the real value from the balance transaction, and the IGY->DEI ETL filters
-- to livemode=true — so this class of leak is closed permanently, with an audit
-- trail (rows retained, flagged) rather than a hard delete.
ALTER TABLE public.subscription_payments
  ADD COLUMN IF NOT EXISTS livemode boolean NOT NULL DEFAULT true;

-- Every existing row is a test-clock artifact -> false. (No live charge has been
-- captured yet; the first real charge lands at trial-end ~Aug 12.)
UPDATE public.subscription_payments SET livemode = false;

-- Reporting/rollup should only ever count live money.
CREATE INDEX IF NOT EXISTS idx_subscription_payments_livemode
  ON public.subscription_payments (livemode);
