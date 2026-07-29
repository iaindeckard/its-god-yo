-- Bounty program v2 — align igy_bounty_credits to the v2 spec
-- (IGY-Translation-Error-Bounty-Spec-2026-07-29-v2.md), pass 1: reward engine.
--
-- The reward is no longer a flat $6.99 INTERNAL credit that a human manually
-- redeems. It is now a Stripe customer-balance credit equal to 1/12 of the
-- winner's ACTUAL annual price (computed per customer, same mechanism as
-- referral_reward_ledger), applied automatically to their next invoice. So:
--   * amount_cents is always computed at issuance (no flat default)
--   * status set becomes issued | skipped | reversed
--       - issued   : a Stripe balance credit was created; auto-applies next invoice
--       - skipped  : winner had no resolvable Stripe customer/active subscription
--                    (needs manual follow-up) — see skipped_reason
--       - reversed : credit later clawed back (pass 2)
--   * stripe_balance_transaction_id records the Stripe txn for audit
--
-- The legacy earned/applied manual-redemption columns (applied_at/applied_by/
-- applied_note) are intentionally LEFT IN PLACE (unused) per Iain — non-destructive.
-- The table is empty at migration time, so the status/CHECK swap is safe.
--
-- RLS is already ENABLED on this table with no policies (service-role only,
-- matching the referral_* tables); no policy changes needed.

ALTER TABLE public.igy_bounty_credits
  ALTER COLUMN amount_cents DROP DEFAULT;

ALTER TABLE public.igy_bounty_credits
  ADD COLUMN IF NOT EXISTS stripe_balance_transaction_id text,
  ADD COLUMN IF NOT EXISTS skipped_reason text;

ALTER TABLE public.igy_bounty_credits
  DROP CONSTRAINT IF EXISTS igy_bounty_credits_status_check;

ALTER TABLE public.igy_bounty_credits
  ALTER COLUMN status SET DEFAULT 'issued';

ALTER TABLE public.igy_bounty_credits
  ADD CONSTRAINT igy_bounty_credits_status_check
  CHECK (status IN ('issued','skipped','reversed'));

COMMENT ON COLUMN public.igy_bounty_credits.amount_cents IS
  'Computed at issuance = 1/12 of the winner''s annual price (their real Stripe sub), capped by the annual ceiling. No default.';
COMMENT ON COLUMN public.igy_bounty_credits.status IS
  'issued = Stripe balance credit created (auto-applies next invoice); skipped = no resolvable customer/sub; reversed = clawed back.';
