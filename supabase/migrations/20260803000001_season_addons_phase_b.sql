-- Holy Season add-ons — Phase B: enrollment + moving-date off-session billing.
-- Service-role only (no RLS policies), same posture as consent_log / pending_signups.
-- Applied via MCP apply_migration per the IGY migration rule (never `db push`).

-- (1) season_content_batches — readiness signal for a season's pre-generated batch.
--     Minimal here; Phase C extends it with generation/review-queue columns. The
--     billing cron HARD-GATES on status='approved' — never charge for content that
--     isn't ready to send (Iain, 2026-08-03).
CREATE TABLE IF NOT EXISTS public.season_content_batches (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_key     text NOT NULL CHECK (season_key IN ('advent','christmastide','lent','eastertide')),
  liturgical_year int NOT NULL,
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_review','approved')),
  approved_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (season_key, liturgical_year)
);
COMMENT ON TABLE public.season_content_batches IS
  'Per season+year content-batch readiness. Phase B reads status; Phase C owns generation/review. Billing charges only when status=approved.';

-- (2) season_enrollments — one row per (Stripe customer = billing entity, season).
--     Whole-family toggle: applies to every teen on the account. `quantity` is the
--     teen count captured at enroll; charge-time reconciliation to the current teen
--     count is a Phase E/reconcile follow-up (mirrors family extra-teen reconcile).
CREATE TABLE IF NOT EXISTS public.season_enrollments (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_customer_id       text NOT NULL,               -- cus_... (no FK; matches subscription_payments)
  season_key               text NOT NULL CHECK (season_key IN ('advent','christmastide','lent','eastertide')),
  status                   text NOT NULL DEFAULT 'active' CHECK (status IN ('active','canceled')),
  auto_renew               boolean NOT NULL DEFAULT true,
  quantity                 int NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  stripe_payment_method_id text,
  enrolled_at              timestamptz NOT NULL DEFAULT now(),
  canceled_at              timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (stripe_customer_id, season_key)
);
COMMENT ON TABLE public.season_enrollments IS
  'Whole-family season add-on enrollment, one per (Stripe customer, season). Auto-renews yearly via the moving-date billing cron — NOT a Stripe subscription.';

-- (3) season_charges — idempotent annual charge ledger. ONE row per (enrollment,
--     season_year). The UNIQUE is the claim-first idempotency guard: the cron inserts
--     (ON CONFLICT DO NOTHING) BEFORE charging, so a re-run can never double-charge.
--     season_year = the calendar year the season's window starts.
CREATE TABLE IF NOT EXISTS public.season_charges (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id           uuid NOT NULL REFERENCES public.season_enrollments(id) ON DELETE CASCADE,
  season_key              text NOT NULL,
  season_year             int NOT NULL,
  season_start            date NOT NULL,
  charge_date             date NOT NULL,
  status                  text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','succeeded','failed')),
  quantity                int NOT NULL,
  amount_cents            int NOT NULL,
  stripe_payment_intent_id text,
  attempted_at            timestamptz,
  error                   text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (enrollment_id, season_year)
);
COMMENT ON TABLE public.season_charges IS
  'Idempotent annual season charge ledger. UNIQUE(enrollment_id, season_year) is the claim-first double-charge guard.';

CREATE INDEX IF NOT EXISTS idx_season_enrollments_billable
  ON public.season_enrollments (season_key) WHERE status = 'active' AND auto_renew;
CREATE INDEX IF NOT EXISTS idx_season_charges_enrollment
  ON public.season_charges (enrollment_id);
