-- Preorder / activation state machine (layered on pending_signups).
--
-- New lifecycle for a preorder-origin signup:
--   preorder_pending            -- card saved at signup, no subscription, no SMS yet
--     -> awaiting_confirmation   -- admin launch trigger fired; "reply YES" SMS+email sent
--        -> active               -- YES + immediate charge succeeded (no trial)
--        -> payment_failed       -- YES + card declined
--             -> active          -- retry-link charge succeeded
--             -> removed         -- 7d timeout: PII scrubbed + Stripe customer deleted + stub
--        -> removed              -- 7d no-response timeout: same scrub + stub
--
-- Normal (non-preorder) signups are unaffected: they still go straight to
-- awaiting_confirmation and their YES creates a 7-day-trial subscription.
-- The `is_preorder` flag is the discriminator the YES handler + timeout cron use.
--
-- NOTE (IGY workflow): IGY schema is applied via MCP apply_migration, NOT
-- `supabase db push` (local migrations drift from remote). This file is the
-- repo-of-record copy of what was applied.

-- 1) Widen the status CHECK with the three new preorder-only states. The other
--    values are the live set (verified against prod), preserved verbatim.
ALTER TABLE public.pending_signups DROP CONSTRAINT IF EXISTS pending_signups_status_check;
ALTER TABLE public.pending_signups ADD CONSTRAINT pending_signups_status_check
  CHECK (status = ANY (ARRAY[
    'awaiting_confirmation'::text,
    'confirmed'::text,
    'subscription_created'::text,
    'active'::text,
    'past_due'::text,
    'requires_action'::text,
    'expired'::text,
    'canceled'::text,
    'preorder_pending'::text,
    'payment_failed'::text,
    'removed'::text
  ]));

-- 2) State-machine columns. is_preorder is the only NOT NULL add (defaults false
--    so existing rows are correctly treated as normal-flow). The clocks are
--    nullable and stamped as the row moves through the machine.
ALTER TABLE public.pending_signups
  ADD COLUMN IF NOT EXISTS is_preorder boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS confirmation_sent_at timestamptz,             -- stamped by the launch trigger
  ADD COLUMN IF NOT EXISTS confirmation_reminder_sent_at timestamptz,    -- one-shot ~3d reminder guard
  ADD COLUMN IF NOT EXISTS payment_failed_at timestamptz,                -- independent clock from confirmation_sent_at
  ADD COLUMN IF NOT EXISTS payment_failed_reminder_sent_at timestamptz;  -- one-shot ~3d reminder guard

-- Cheap lookups for the daily timeout cron (only ever scans preorder rows).
CREATE INDEX IF NOT EXISTS pending_signups_preorder_status_idx
  ON public.pending_signups (status)
  WHERE is_preorder;

-- 3) Clean, PII-free stub of a removed preorder. Deliberately has NO PII columns
--    (not even nullable ones) — it exists precisely so the fact "a preorder was
--    removed" survives after the PII-bearing rows are scrubbed. created_at is
--    copied from the original signup (cohort timing); id is a fresh UUID.
CREATE TABLE IF NOT EXISTS public.removed_signups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL,
  removed_at  timestamptz NOT NULL DEFAULT now(),
  reason      text NOT NULL CHECK (reason IN ('no_response', 'payment_failed'))
);

-- Service-role only (matches pending_signups): RLS on, no policies.
ALTER TABLE public.removed_signups ENABLE ROW LEVEL SECURITY;
