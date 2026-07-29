-- Bounty v2 pass 1 — add the 'reconcile' credit status.
--
-- Failure mode being handled: the Stripe customer-balance credit succeeds (money
-- moved to the customer) but the igy_bounty_credits ledger insert then fails.
-- This project has no Sentry/log-drain, so a console.error would vanish and the
-- credit would be invisible in the admin ledger forever — violating the spec's
-- "never silent" principle.
--
-- 'reconcile' means: the credit WAS issued in Stripe (unlike 'skipped', where no
-- money moved) but our ledger write was degraded. It counts as money-issued AND
-- surfaces in the admin "needs follow-up" bucket so a human verifies/repairs it.
-- The row carries the real amount_cents + stripe_balance_transaction_id, with the
-- explanation in skipped_reason.

ALTER TABLE public.igy_bounty_credits
  DROP CONSTRAINT IF EXISTS igy_bounty_credits_status_check;

ALTER TABLE public.igy_bounty_credits
  ADD CONSTRAINT igy_bounty_credits_status_check
  CHECK (status IN ('issued','skipped','reversed','reconcile'));

COMMENT ON COLUMN public.igy_bounty_credits.status IS
  'issued = Stripe balance credit created (auto-applies next invoice); skipped = no resolvable customer/sub (no money moved); reconcile = credit issued in Stripe but ledger write degraded (money moved, needs human verify); reversed = clawed back.';
