-- Church group enrollment — Phase 1 (Option B: individual billing, church-attributed).
--
-- A minister with a large youth group can't type in each teen one at a time. Instead
-- each Cornerstone Partner church gets a shareable enrollment link + short code; a
-- teen who receives it self-enrolls through the EXISTING signup flow entering their
-- own info, and arriving via the link auto-attributes the resulting subscription to
-- that church. Billing is unchanged — each teen bills individually as today. NO bulk
-- phone/roster upload (TCPA), NO pre-paid seat blocks, NO roster tracker (Option A +
-- roster are deferred to Phase 2; the seats_purchased column below is the only hook
-- left for them so they become additive, not a schema change).

-- ---------------------------------------------------------------------------
-- church_enrollment_links — one active shareable link/code per partner.
--
-- The long-URL access token (issued in app code) is an HMAC over the partner UUID,
-- namespaced "enroll:" so it is DISTINCT from the private status-page token: an
-- enrollment link is broadcast to hundreds of teens and must NEVER also grant
-- access to the church's private status / certificate page. short_code is the
-- human handle (read aloud, printed in a bulletin).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.church_enrollment_links (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cornerstone_partner_id uuid NOT NULL REFERENCES public.cornerstone_partners (id) ON DELETE CASCADE,
  short_code             text NOT NULL UNIQUE,
  status                 text NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active','paused','revoked')),
  -- Phase 2 (Option A, church-sponsored seat blocks) hook: NULL = attribution-only
  -- (Phase 1, always). A future integer = a pre-paid seat cap. Present now so the
  -- block feature is an additive fill-in rather than a table migration.
  seats_purchased        integer,
  created_by             uuid,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
-- At most one non-revoked link per partner. Rotating a code = revoke the old row +
-- insert a new one, so history is retained and old codes stop resolving.
CREATE UNIQUE INDEX IF NOT EXISTS idx_church_enroll_links_partner_live
  ON public.church_enrollment_links (cornerstone_partner_id)
  WHERE status <> 'revoked';
CREATE INDEX IF NOT EXISTS idx_church_enroll_links_code
  ON public.church_enrollment_links (short_code) WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- Attribution columns on pending_signups — the SINGLE source of truth for church
-- attribution. submit-consent writes them; lib/createSubscription copies
-- cornerstone_partner_id into the live Stripe subscription metadata; church
-- revenue (when needed) joins subscription_payments -> pending_signups on
-- stripe_subscription_id, so the payment-ledger writer stays untouched.
-- ---------------------------------------------------------------------------
ALTER TABLE public.pending_signups
  ADD COLUMN IF NOT EXISTS cornerstone_partner_id uuid
    REFERENCES public.cornerstone_partners (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS enrollment_link_id uuid
    REFERENCES public.church_enrollment_links (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_pending_signups_cornerstone_partner
  ON public.pending_signups (cornerstone_partner_id)
  WHERE cornerstone_partner_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- v_church_enrollment_progress — per-partner counts for the church dashboard
-- ("X teens have joined through your link"). Buckets over the real status domain
-- (awaiting_confirmation | confirmed | subscription_created | active | past_due |
-- requires_action | expired | canceled). "joined" = a subscription exists (the
-- teen replied YES); "active" = past the first real charge.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_church_enrollment_progress
WITH (security_invoker = true) AS
SELECT
  ps.cornerstone_partner_id,
  count(*)                                                                          AS total_started,
  count(*) FILTER (WHERE ps.status = 'awaiting_confirmation')                       AS awaiting_confirmation,
  count(*) FILTER (WHERE ps.status IN
    ('confirmed','subscription_created','active','past_due','requires_action'))     AS joined,
  count(*) FILTER (WHERE ps.status = 'active')                                      AS active,
  count(*) FILTER (WHERE ps.status IN ('expired','canceled'))                       AS lapsed,
  max(ps.created_at)                                                                AS last_signup_at
FROM public.pending_signups ps
WHERE ps.cornerstone_partner_id IS NOT NULL
GROUP BY ps.cornerstone_partner_id;

-- ---------------------------------------------------------------------------
-- RLS: service-role only, no policies — matching the Cornerstone tables. All
-- reads/writes go through the service-role admin client in server code.
-- ---------------------------------------------------------------------------
ALTER TABLE public.church_enrollment_links ENABLE ROW LEVEL SECURITY;
