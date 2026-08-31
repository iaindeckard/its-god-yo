-- Add a 'pending_payment' pre-state to christmas_gift_2026_purchases and make it the
-- default. The checkout route inserts the row in 'pending_payment' BEFORE the one-time
-- charge settles; the Stripe webhook (payment_intent.succeeded) advances it to
-- 'awaiting_release' only once the charge is confirmed. This prevents an abandoned or
-- SCA-failed payment from leaving a row the release-day cron would text a recipient
-- about. Existing values preserved verbatim.
ALTER TABLE public.christmas_gift_2026_purchases DROP CONSTRAINT IF EXISTS christmas_gift_2026_purchases_status_check;
ALTER TABLE public.christmas_gift_2026_purchases ADD CONSTRAINT christmas_gift_2026_purchases_status_check
  CHECK (status = ANY (ARRAY['pending_payment','awaiting_release','confirmation_sent','confirmed','credited','canceled']));
ALTER TABLE public.christmas_gift_2026_purchases ALTER COLUMN status SET DEFAULT 'pending_payment';

-- The partial index for the release-day cron already targets status='awaiting_release',
-- so pending_payment rows are naturally excluded from that hot path. No index change needed.
