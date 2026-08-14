-- Growth Engine Phase 1: trusted outreach attribution.
--
-- A click from a reviewed outreach email enters through a server-validated signed
-- link. The application records a short-lived attribution session here, then
-- carries only this non-sensitive UUID through signup and into Stripe metadata.
-- This fixes the current Touch 1 attribution gap without making browser analytics
-- a financial source of truth.
--
-- Confidence policy:
--   direct = trusted outreach session survived to pending_signup/subscription
--   strong = unique lead-specific promotion code survived to the purchase
-- Direct wins if both signals exist. Probable/unattributed remain analysis-only
-- and are intentionally absent from the realized-revenue view below.

create table if not exists public.outreach_attribution_sessions (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.igy_outreach_leads(id) on delete restrict,
  campaign_id uuid not null references public.outreach_campaigns(id) on delete restrict,
  touch smallint not null check (touch in (1, 2)),
  language text not null check (language in ('en', 'es')),
  landed_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now()
);

create index if not exists idx_outreach_attr_sessions_lead
  on public.outreach_attribution_sessions (lead_id, landed_at desc);
create index if not exists idx_outreach_attr_sessions_campaign
  on public.outreach_attribution_sessions (campaign_id, landed_at desc);
create index if not exists idx_outreach_attr_sessions_expires
  on public.outreach_attribution_sessions (expires_at);

alter table public.outreach_attribution_sessions enable row level security;
-- No policies: service-role/server only. A browser never writes attribution.

alter table public.pending_signups
  add column if not exists outreach_attribution_session_id uuid
    references public.outreach_attribution_sessions(id) on delete set null;

create index if not exists idx_pending_signups_outreach_attr_session
  on public.pending_signups (outreach_attribution_session_id)
  where outreach_attribution_session_id is not null;

-- Realized payment attribution. subscription_payments remains the money ledger;
-- this view only answers WHY a settled row is credited to an outreach campaign.
-- Signed settled_net_cents preserves fees/refunds/chargebacks exactly as the
-- payment ledger records them. Direct attribution has precedence over promo-code
-- attribution so the same payment can never be counted twice. Strong evidence is
-- admitted only when a promotion-code id belongs to exactly one campaign lead.
create or replace view public.v_outreach_payment_attribution
with (security_invoker = true) as
with unique_promo_leads as (
  select
    promo_promotion_code_id,
    min(id) as lead_id,
    min(campaign_id) as campaign_id
  from public.igy_outreach_leads
  where promo_promotion_code_id is not null
    and campaign_id is not null
  group by promo_promotion_code_id
  having count(*) = 1
),
direct_payments as (
  select
    sp.id as payment_id,
    ps.id as pending_signup_id,
    s.id as attribution_session_id,
    s.lead_id,
    s.campaign_id,
    s.touch,
    s.language,
    'direct'::text as confidence,
    sp.stripe_subscription_id,
    sp.stripe_created_at,
    sp.kind,
    sp.status,
    sp.settled_currency,
    sp.settled_net_cents
  from public.subscription_payments sp
  join public.pending_signups ps
    on ps.stripe_subscription_id = sp.stripe_subscription_id
  join public.outreach_attribution_sessions s
    on s.id = ps.outreach_attribution_session_id
  where sp.business_unit = 'igy'
    and sp.livemode = true
),
strong_payments as (
  select
    sp.id as payment_id,
    ps.id as pending_signup_id,
    null::uuid as attribution_session_id,
    upl.lead_id,
    upl.campaign_id,
    null::smallint as touch,
    ps.language,
    'strong'::text as confidence,
    sp.stripe_subscription_id,
    sp.stripe_created_at,
    sp.kind,
    sp.status,
    sp.settled_currency,
    sp.settled_net_cents
  from public.subscription_payments sp
  join public.pending_signups ps
    on ps.stripe_subscription_id = sp.stripe_subscription_id
  join unique_promo_leads upl
    on upl.promo_promotion_code_id = ps.promo_promotion_code_id
  where sp.business_unit = 'igy'
    and sp.livemode = true
    and ps.outreach_attribution_session_id is null
)
select * from direct_payments
union all
select * from strong_payments;

comment on view public.v_outreach_payment_attribution is
  'Growth Engine Phase 1 realized outreach payment attribution. Direct signed-session evidence wins; only uniquely mapped lead promo evidence is Strong. Uses signed settled_net_cents and excludes probable/unattributed guesses.';
