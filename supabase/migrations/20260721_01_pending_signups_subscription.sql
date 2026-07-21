-- Track the deferred subscription once it is created on SMS confirmation.
-- The creator sets status='subscription_created' + stores the Stripe id, and is
-- idempotent (won't re-create if this is already set).
ALTER TABLE public.pending_signups
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS subscription_created_at timestamptz;
