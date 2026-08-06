-- Reusable cause-promotion tracking (LOCKED spec 2026-08-06). Generalizes the
-- Camp Hardtner pledge into a parameterized mechanism for any promo-code-driven
-- charity promotion. Tracking/computation only — payout at disbursement time reuses
-- the existing generic igy_donation_disbursements table (charity_name, amount_cents,
-- triggered_by='cause_promotion:<id>'). Deliberately SEPARATE from
-- igy_donation_fund_ledger (the company-wide tithe on overall net profit).

create table if not exists public.cause_promotions (
  id            uuid        primary key default gen_random_uuid(),
  charity_name  text        not null,
  payout_rate   numeric     not null check (payout_rate >= 0 and payout_rate <= 1),
  -- All per-promotion conditions are independent AND filters, each individually
  -- optional (null = no requirement on that dimension).
  qualifying_promo_codes text[] not null default '{}',
  -- Billing cadence requirement: 'annual' or 'monthly' (the plan's INTERVAL, not a
  -- literal plan_key). Matched against the interval derived from pending_signups
  -- .plan_key the same way lib/plans.ts intervalForBaseKey does (see the view).
  -- null = any plan qualifies.
  require_plan_type text,
  -- Kept a plain boolean to match pending_signups.dm_addon (the only add-on type
  -- today). If a second add-on type ever ships, this needs an add-on identifier
  -- instead; boolean is sufficient for foreseeable needs.
  require_dm_addon boolean,
  start_date    date        not null,
  end_date      date        not null,
  status        text        not null default 'active' check (status in ('active', 'closed', 'paid')),
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (end_date >= start_date)
);

alter table public.cause_promotions enable row level security;
-- No policies: service-role only, like the other back-office tables.

-- One generic, parameterized segment computation (filter either view by
-- promotion_id). Per (promotion, qualifying subscription): the subscription is a
-- member when it matches EVERY set condition on the promotion row AND was purchased
-- within the window. Net proceeds come from the canonical settled_net_cents
-- (bt.net: charge +, refund/dispute -), so summing across kinds excludes Stripe
-- fees and nets out refunds AND chargebacks with no bespoke definition.
create or replace view public.v_cause_promotion_members
with (security_invoker = true) as
with sub_net as (
  select stripe_subscription_id,
         sum(coalesce(settled_net_cents, 0))    as net_cents,
         sum(coalesce(settled_amount_cents, 0)) as gross_settled_cents
  from public.subscription_payments
  where livemode = true
    and stripe_subscription_id is not null
  group by stripe_subscription_id
)
select
  cp.id                          as promotion_id,
  cp.charity_name,
  ps.id                          as pending_signup_id,
  ps.stripe_subscription_id,
  ps.purchaser_email,
  ps.plan_key,
  -- Same rule as lib/plans.ts intervalForBaseKey: individual_monthly is the ONLY
  -- monthly plan; every other plan_key (individual_annual, family_annual,
  -- gift_annual, group_*) bills annually.
  case when ps.plan_key = 'individual_monthly' then 'monthly' else 'annual' end as sub_interval,
  ps.promo_code,
  ps.dm_addon,
  ps.subscription_created_at,
  coalesce(sn.net_cents, 0)           as net_cents,
  coalesce(sn.gross_settled_cents, 0) as gross_settled_cents
from public.cause_promotions cp
join public.pending_signups ps
  on ps.stripe_subscription_id is not null
 and ps.promo_code = any (cp.qualifying_promo_codes)
 and (cp.require_dm_addon is null or ps.dm_addon = cp.require_dm_addon)
 and (cp.require_plan_type is null
      or cp.require_plan_type = case when ps.plan_key = 'individual_monthly' then 'monthly' else 'annual' end)
 and ps.subscription_created_at is not null
 and ps.subscription_created_at::date >= cp.start_date
 and ps.subscription_created_at::date <= cp.end_date
left join sub_net sn on sn.stripe_subscription_id = ps.stripe_subscription_id;

-- Per-promotion rollup: member count, segment gross/net, and the pledged payout
-- (net x rate) ready to write to igy_donation_disbursements at payout time. LEFT
-- JOIN so a promotion with zero members still appears with 0s.
create or replace view public.v_cause_promotion_totals
with (security_invoker = true) as
select
  cp.id            as promotion_id,
  cp.charity_name,
  cp.payout_rate,
  cp.status,
  cp.start_date,
  cp.end_date,
  count(m.stripe_subscription_id)                              as member_subscriptions,
  coalesce(sum(m.gross_settled_cents), 0)::bigint             as segment_gross_cents,
  coalesce(sum(m.net_cents), 0)::bigint                       as segment_net_cents,
  round(coalesce(sum(m.net_cents), 0) * cp.payout_rate)::bigint as payout_cents
from public.cause_promotions cp
left join public.v_cause_promotion_members m on m.promotion_id = cp.id
group by cp.id, cp.charity_name, cp.payout_rate, cp.status, cp.start_date, cp.end_date;

-- Seed the first real promotion: Camp Hardtner (Bishop Owensby pledge, 2026-08-04).
-- Idempotent so re-running the migration never duplicates it.
insert into public.cause_promotions
  (charity_name, payout_rate, qualifying_promo_codes, require_plan_type, require_dm_addon, start_date, end_date, status, notes)
select 'Camp Hardtner', 0.20, array['igy_episcopal', 'igy_hardtner'], 'annual', true,
       date '2026-08-04', date '2026-12-31', 'active',
       'Bishop Owensby email pledge: 20% of net proceeds from annual + DM-from-Him subscriptions bought with igy_episcopal/igy_hardtner, Aug 4 - Dec 31 2026.'
where not exists (
  select 1 from public.cause_promotions where charity_name = 'Camp Hardtner' and start_date = date '2026-08-04'
);
