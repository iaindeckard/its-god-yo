-- Church / youth-org outreach agent — lead store.
-- Spec: IGY-Church-Outreach-Agent-Spec-v1-READY-CORRECTED.md (Drive, "Claude
-- Workspace - Iain"), §3. Turns the manual Wichita batch into a monthly
-- automated discover -> send -> convert pipeline.
--
-- LIFECYCLE (spec §1, §7.3). A lead is born 'active' (or 'needs_review' when the
-- discovery job's confidence is low — see §3) and stays in the monthly rotation
-- until exactly one of:
--   converted      -> its promo code was redeemed (Stripe webhook, §5)
--   unsubscribed   -> one-click List-Unsubscribe / reply opt-out (§2) — PERMANENT
--   bounced_hard   -> provider hard-bounce webhook (§2) — PERMANENT
--   aged_out       -> sent to 6 times without converting (§7.3)
--
-- SUPPRESSION IS PERMANENT (spec §2): once a row is unsubscribed/bounced_hard it
-- must NEVER receive another send, even if a later monthly scan rediscovers the
-- same org. That invariant is enforced two ways: (1) the send job filters on
-- status='active' only, and (2) the discovery upsert keys on lower(contact_email)
-- and, on conflict, only refreshes last_verified_at for rows that are STILL
-- 'active' — it never resurrects a converted/unsubscribed/bounced/aged_out row.
-- The unique email index below is what makes that upsert idempotent and is the
-- structural guarantee behind "don't re-add the same org next month."
--
-- This table is written only by server-side code (discovery Edge Function, the
-- Stripe webhook, the admin UI) via the service role. RLS is enabled with NO
-- anon/authenticated policy, so the public keys can't read or write it. Contact
-- emails here are public org addresses, but there is no reason to expose the
-- lead pipeline (promo codes, conversion values) client-side.

CREATE TABLE IF NOT EXISTS public.igy_outreach_leads (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity, as found (spec §3)
  org_name               text NOT NULL,
  city                   text,
  state                  text,
  denomination_type      text,                 -- free text: 'Catholic', 'Non-denominational', etc.
  contact_email          text NOT NULL,        -- the PUBLIC general/office address (never a personal/staff email — §4 guardrail)
  phone                  text,
  website                text,

  -- Evidence — so a human can always spot-check why this lead exists (spec §3, §4)
  youth_ministry_signal  text,                 -- what was found + where (e.g. "'Student Ministry — Wednesdays 6:30p' on /ministries, retrieved 2026-07-27")
  source_urls            jsonb NOT NULL DEFAULT '[]'::jsonb,  -- pages actually used to confirm email + youth signal; no un-sourced leads
  discovery_confidence   text,                 -- 'high' | 'medium' | 'low' — drives active vs needs_review at insert time

  -- Lifecycle
  status                 text NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active','converted','unsubscribed','bounced_hard','needs_review','aged_out')),

  -- Conversion (spec §5) — a unique per-lead Stripe PromotionCode, minted at
  -- first send, 10% off. Reuses lib/promoCodes.ts (coupon + PromotionCode).
  promo_code             text,                 -- the customer-facing code string
  promo_promotion_code_id text,                -- resolved Stripe promotion_code id (promo_...), so the webhook matches redemptions without re-resolving

  -- Timestamps + send accounting
  first_found_at         timestamptz NOT NULL DEFAULT now(),
  last_verified_at       timestamptz NOT NULL DEFAULT now(),
  last_sent_at           timestamptz,
  send_count             integer NOT NULL DEFAULT 0,   -- ages out at 6 (spec §7.3)

  -- Filled by the Stripe webhook on redemption (spec §5)
  converted_at           timestamptz,
  conversion_value_cents integer,

  -- Filled by suppression events (spec §2)
  unsubscribed_at        timestamptz,
  bounce_reason          text,

  -- Filled when the 6-months-unconverted rule fires (spec §7.3)
  aged_out_at            timestamptz,

  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- One row per organization email. This is the anti-duplicate / anti-resurrection
-- guarantee: rediscovery of an already-known (incl. suppressed) org hits this
-- constraint and the upsert leaves the existing row's status untouched.
CREATE UNIQUE INDEX IF NOT EXISTS uq_outreach_leads_email
  ON public.igy_outreach_leads (lower(contact_email));

-- The monthly send job selects on status; keep it fast.
CREATE INDEX IF NOT EXISTS idx_outreach_leads_status ON public.igy_outreach_leads (status);
-- The webhook matches a redeemed code back to its lead.
CREATE INDEX IF NOT EXISTS idx_outreach_leads_promo_code ON public.igy_outreach_leads (promo_code);

-- RBAC (reuses the 'marketing' category added by the sponsor program migration).
-- Reviewing needs_review leads and reading the pipeline is a staff/owner action.
INSERT INTO public.permissions (key, label, category) VALUES
  ('marketing.outreach.view',   'View church outreach leads',                 'marketing'),
  ('marketing.outreach.manage', 'Approve/edit/suppress outreach leads',        'marketing')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (job_role, permission_key, enabled) VALUES
  ('super_admin',      'marketing.outreach.view',   true),
  ('super_admin',      'marketing.outreach.manage', true),
  ('content_reviewer', 'marketing.outreach.view',   false),
  ('content_reviewer', 'marketing.outreach.manage', false)
ON CONFLICT (job_role, permission_key) DO UPDATE SET enabled = EXCLUDED.enabled;

ALTER TABLE public.igy_outreach_leads ENABLE ROW LEVEL SECURITY;
