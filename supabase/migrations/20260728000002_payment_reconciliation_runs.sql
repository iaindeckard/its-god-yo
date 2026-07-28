-- =============================================================================
-- payment_reconciliation_runs — audit + alert surface for the subscription_payments
-- backfill safety net (app/api/cron/reconcile-payments).
--
-- The webhook capture is best-effort (safeCapture swallows failures to protect
-- status/referral logic) and a swallowed capture has NO Stripe retry. The
-- reconcile cron is the durability guarantee: it lists Stripe balance
-- transactions, backfills anything missing from subscription_payments, and writes
-- ONE row here per run. This table is what makes the safety net observable:
--   - a run with gaps_over_grace > 0 means the webhook silently failed to capture
--     a payment (and the cron backfilled it) — the cron also emails on this.
--   - a run with error IS NOT NULL means the safety net itself failed — so a
--     broken reconcile job is visible rather than silently dead.
-- A DEI/ops health panel can read the latest row for "last run / gaps".
--
-- Written only by the cron (service role). RLS on, no policies — same locked-down
-- posture as subscription_payments / pending_signups.
--
-- Applied via MCP apply_migration (IGY convention — `supabase db push` is unsafe
-- on this project due to local-vs-remote migration drift; see the IGY migration
-- notes). ROLLBACK: DROP TABLE IF EXISTS public.payment_reconciliation_runs;
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.payment_reconciliation_runs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at            timestamptz NOT NULL DEFAULT now(),
  window_start      timestamptz,                       -- look-back start for this run
  window_days       integer,                           -- 7 (daily) or 40 (monthly deep-reconcile)
  scanned           integer,                           -- total balance transactions listed
  in_scope          integer,                           -- charge(invoice)/refund/dispute matching webhook scope
  already_present   integer,                           -- of in_scope, how many were already in the ledger
  backfilled        integer,                           -- rows actually inserted this run
  gaps_over_grace   integer,                           -- webhook-responsible AND older than 2h grace = real gaps
  gap_bt_ids        jsonb NOT NULL DEFAULT '[]'::jsonb, -- the alert-worthy balance-transaction ids
  dry_run           boolean NOT NULL DEFAULT false,
  error             text,                              -- non-null => the run itself failed
  duration_ms       integer,
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.payment_reconciliation_runs IS
  'One row per reconcile-payments cron run. Audit + alert surface for the subscription_payments backfill safety net: gaps_over_grace>0 = webhook silently failed to capture a payment (backfilled here); error IS NOT NULL = the safety net itself failed. Service-role only, RLS on.';
COMMENT ON COLUMN public.payment_reconciliation_runs.gaps_over_grace IS
  'Count of webhook-responsible payments that were missing beyond the 2h grace window (i.e. the webhook capture silently failed). Excludes dispute_reversals (reconcile-only, never a webhook duty) and rows younger than grace (webhook likely still in flight).';

CREATE INDEX IF NOT EXISTS idx_payment_reconciliation_runs_ran_at ON public.payment_reconciliation_runs (ran_at DESC);

ALTER TABLE public.payment_reconciliation_runs ENABLE ROW LEVEL SECURITY;
