-- Referral attribution for Scheduled Gift purchases.
-- referral_events currently links the referred purchase ONLY via referee_pending_signup_id
-- (NOT NULL, FK -> pending_signups). Scheduled Gift purchases deliberately create NO
-- pending_signups row at purchase, so we add a parallel nullable link to the new campaign table,
-- relax the old column to nullable, and require EXACTLY ONE of the two links per row. Existing
-- rows (all have referee_pending_signup_id set, new column null) satisfy the XOR unchanged.
-- referral_events.status is left untouched (live constraint already carries all values in use).
ALTER TABLE public.referral_events
  ADD COLUMN IF NOT EXISTS referee_christmas_gift_purchase_id uuid
    REFERENCES public.christmas_gift_2026_purchases(id);

ALTER TABLE public.referral_events
  ALTER COLUMN referee_pending_signup_id DROP NOT NULL;

-- Exactly one referred-purchase link (pending_signups path XOR scheduled-gift path).
ALTER TABLE public.referral_events
  DROP CONSTRAINT IF EXISTS referral_events_one_referee_link;
ALTER TABLE public.referral_events
  ADD CONSTRAINT referral_events_one_referee_link
  CHECK (num_nonnulls(referee_pending_signup_id, referee_christmas_gift_purchase_id) = 1);

-- One referral_event per scheduled-gift purchase (mirrors the existing UNIQUE on referee_pending_signup_id).
CREATE UNIQUE INDEX IF NOT EXISTS referral_events_christmas_gift_uq
  ON public.referral_events (referee_christmas_gift_purchase_id)
  WHERE referee_christmas_gift_purchase_id IS NOT NULL;
