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
revoke all on table public.outreach_attribution_sessions from public, anon, authenticated;
revoke all on table public.outreach_attribution_sessions from service_role;
grant select, insert, update, delete on table public.outreach_attribution_sessions to service_role;

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
with unique_charge_subscriptions as (
  -- Refund/dispute ledger rows intentionally carry no subscription id. Recover it
  -- only from an unambiguous settled charge row sharing the same Stripe charge.
  select stripe_charge_id, min(stripe_subscription_id) as stripe_subscription_id
  from public.subscription_payments
  where stripe_charge_id is not null
    and stripe_subscription_id is not null
  group by stripe_charge_id
  having count(distinct stripe_subscription_id) = 1
),
unique_invoice_subscriptions as (
  select stripe_invoice_id, min(stripe_subscription_id) as stripe_subscription_id
  from public.subscription_payments
  where stripe_invoice_id is not null
    and stripe_subscription_id is not null
  group by stripe_invoice_id
  having count(distinct stripe_subscription_id) = 1
),
unique_payment_intent_subscriptions as (
  select stripe_payment_intent_id, min(stripe_subscription_id) as stripe_subscription_id
  from public.subscription_payments
  where stripe_payment_intent_id is not null
    and stripe_subscription_id is not null
  group by stripe_payment_intent_id
  having count(distinct stripe_subscription_id) = 1
),
payment_lineage as (
  select
    sp.*,
    coalesce(
      sp.stripe_subscription_id,
      ucs.stripe_subscription_id,
      uis.stripe_subscription_id,
      upis.stripe_subscription_id
    ) as attributed_subscription_id
  from public.subscription_payments sp
  left join unique_charge_subscriptions ucs
    on ucs.stripe_charge_id = sp.stripe_charge_id
  left join unique_invoice_subscriptions uis
    on uis.stripe_invoice_id = sp.stripe_invoice_id
  left join unique_payment_intent_subscriptions upis
    on upis.stripe_payment_intent_id = sp.stripe_payment_intent_id
),
unique_promo_ids as (
  select promo_promotion_code_id
  from public.igy_outreach_leads
  where promo_promotion_code_id is not null
    and campaign_id is not null
  group by promo_promotion_code_id
  having count(*) = 1
),
unique_promo_leads as (
  select l.promo_promotion_code_id, l.id as lead_id, l.campaign_id
  from public.igy_outreach_leads l
  join unique_promo_ids u
    on u.promo_promotion_code_id = l.promo_promotion_code_id
  where l.campaign_id is not null
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
  from payment_lineage sp
  join public.pending_signups ps
    on ps.stripe_subscription_id = sp.attributed_subscription_id
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
  from payment_lineage sp
  join public.pending_signups ps
    on ps.stripe_subscription_id = sp.attributed_subscription_id
  join unique_promo_leads upl
    on upl.promo_promotion_code_id = ps.promo_promotion_code_id
  where sp.business_unit = 'igy'
    and sp.livemode = true
    and ps.outreach_attribution_session_id is null
)
select * from direct_payments
union all
select * from strong_payments;

revoke all on table public.v_outreach_payment_attribution from public, anon, authenticated;
revoke all on table public.v_outreach_payment_attribution from service_role;
grant select on table public.v_outreach_payment_attribution to service_role;

comment on view public.v_outreach_payment_attribution is
  'Growth Engine Phase 1 realized outreach payment attribution. Direct signed-session evidence wins; only uniquely mapped lead promo evidence is Strong. Uses signed settled_net_cents and excludes probable/unattributed guesses.';
