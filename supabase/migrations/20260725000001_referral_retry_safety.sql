-- Make the Stripe webhook safe to retry. The webhook is moving from
-- swallow-every-error-and-return-200 to surfacing failures as 5xx so Stripe
-- retries with backoff. Two schema facts have to hold first, or those retries
-- would either double-fire side effects or wedge on a constraint error.

-- 1) referral_reward_ledger idempotency.
--    The grant/reversal rows were written with bare INSERTs and no uniqueness.
--    A retry that re-ran after the row was written but before its guard flag
--    (referrer_credit_applied_at / reversed_at) was set would insert a SECOND
--    row — inflating referrerNetRewardsInWindow (the rolling cap) and breaking
--    onRefereePaymentReversed's `.eq("direction","grant").maybeSingle()` (two
--    rows -> error). A unique (referral_event_id, direction) lets the app upsert
--    with ON CONFLICT DO NOTHING so re-entry is a no-op. Table is empty today.
CREATE UNIQUE INDEX IF NOT EXISTS referral_reward_ledger_event_direction_uidx
  ON public.referral_reward_ledger (referral_event_id, direction);

-- 2) pending_signups.status must allow the live-subscription states the webhook
--    writes. The webhook reflects Stripe lifecycle onto this row
--    (active / past_due / requires_action), but the original CHECK only allowed
--    the pre-subscription handoff states, so those writes raised a check_violation
--    on any real subscriber row. It was invisible because the webhook swallowed
--    the error into a 200 (and test-clock subs have no pending_signups row, so the
--    UPDATE matched zero rows). Expand the set to exactly what the code writes.
ALTER TABLE public.pending_signups DROP CONSTRAINT pending_signups_status_check;
ALTER TABLE public.pending_signups ADD CONSTRAINT pending_signups_status_check
  CHECK (status = ANY (ARRAY[
    'awaiting_confirmation'::text,
    'confirmed'::text,
    'subscription_created'::text,
    'active'::text,
    'past_due'::text,
    'requires_action'::text,
    'expired'::text,
    'canceled'::text
  ]));
