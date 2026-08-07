-- Ops "action items" queue: persist manual-review states that previously ONLY
-- fired an ops email (a failed billing attempt, a won chargeback) so they surface
-- on the admin landing page as real, resolvable attention items -- the same way
-- the other pending queues do. One generic, kind-discriminated table (rather than
-- a table per state) so future actionable states can reuse it.

CREATE TABLE IF NOT EXISTS public.igy_action_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,                                   -- 'failed_billing' | 'dispute_review'
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  dedupe_key text NOT NULL,                             -- at most one OPEN item per underlying event
  title text NOT NULL,
  detail text,
  -- pointers to help the operator act on it
  pending_signup_id uuid,
  stripe_customer_id text,
  stripe_charge_id text,
  stripe_dispute_id text,
  stripe_subscription_id text,
  amount_cents bigint,
  currency text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid,
  resolution_note text
);

-- At most one OPEN item per dedupe_key; a resolved row does not block a new one.
CREATE UNIQUE INDEX IF NOT EXISTS igy_action_items_open_dedupe
  ON public.igy_action_items (dedupe_key) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS igy_action_items_open_kind
  ON public.igy_action_items (kind, created_at) WHERE status = 'open';

-- Service-role only (mirrors the other admin queue tables): reads via the
-- service-role client (getSupabaseAdmin), writes/resolves via permission-gated API
-- routes. RLS enabled with no policies => anon/authenticated are denied.
ALTER TABLE public.igy_action_items ENABLE ROW LEVEL SECURITY;

-- RBAC: one permission gating these billing/dispute action items (category
-- 'finance', alongside finance.bounty.view). super_admin enabled; content_reviewer
-- explicitly denied (consistent with its content-only scoping).
INSERT INTO public.permissions (key, label, category) VALUES
  ('finance.action_items.view', 'View & resolve billing/dispute action items', 'finance')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (job_role, permission_key, enabled) VALUES
  ('super_admin', 'finance.action_items.view', true),
  ('content_reviewer', 'finance.action_items.view', false)
ON CONFLICT (job_role, permission_key) DO UPDATE SET enabled = EXCLUDED.enabled;
