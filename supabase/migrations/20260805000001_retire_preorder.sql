-- Retire the preorder / activation state machine. IGY launched straight to full
-- purchases (PURCHASES_ENABLED), so the reserve-ahead-of-launch flow was never
-- used in production. This reverses 20260802000001 + 20260802000002. Applied via
-- MCP apply_migration (IGY workflow); this file is the repo-of-record copy.
--
-- Preconditions verified before applying: 0 rows with is_preorder = true, 0 rows
-- in any preorder-only status, 0 rows in removed_signups, and no code path (Next
-- app or the submit-consent Edge Function, redeployed) references these objects.

-- 1) Drop the preorder-only partial index + state-machine columns.
DROP INDEX IF EXISTS public.pending_signups_preorder_status_idx;
ALTER TABLE public.pending_signups
  DROP COLUMN IF EXISTS is_preorder,
  DROP COLUMN IF EXISTS confirmation_sent_at,
  DROP COLUMN IF EXISTS confirmation_reminder_sent_at,
  DROP COLUMN IF EXISTS payment_failed_at,
  DROP COLUMN IF EXISTS payment_failed_reminder_sent_at;

-- 2) Narrow the status CHECK back to the live (non-preorder) set.
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
    'canceled'::text
  ]));

-- 3) Drop the PII-free removed-preorder stub (empty; only the preorder removal
--    flow ever wrote it).
DROP TABLE IF EXISTS public.removed_signups;

-- 4) Remove the preorder-launch RBAC permission (catalog + per-role grants).
DELETE FROM public.role_permissions WHERE permission_key = 'billing.preorder.launch';
DELETE FROM public.permissions WHERE key = 'billing.preorder.launch';
