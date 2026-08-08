-- Cause-Promotion Tracker — generalize the 8/6 cause_promotions mechanism to the
-- fuller LOCKED spec (2026-08-08). Extends (does not replace) migration
-- 20260806140000_cause_promotions. Decisions locked with Iain:
--   * Rule = any combination of promo / plan-interval / dm-addon (each optional),
--     but at least one condition must be set (no match-everything rule).
--   * Window is datetime (timestamptz) at America/Chicago 00:00 precision.
--     [start_at, end_at): start inclusive, end exclusive. MEMBERSHIP freezes at
--     end_at (no new subs join the pool after it).
--   * POTENTIAL revenue = in-trial matching subs (not cancelled, not yet charged)
--     valued at their captured expected_first_charge_cents; expires (→0) at end_at.
--   * REALIZED revenue = settled livemode payments (subscription_payments), and it
--     KEEPS accruing after end_at for already-tagged subs (a Dec-30 signup that
--     converts in January still counts — the pledge is about who joined in-window).
--   * payout_rate applies to REALIZED ONLY, never potential.

-- ── 1. Extend cause_promotions ────────────────────────────────────────────────
alter table public.cause_promotions
  add column if not exists start_at    timestamptz,
  add column if not exists end_at      timestamptz,
  add column if not exists customer_facing_enabled boolean not null default false,
  add column if not exists public_title text,
  add column if not exists public_blurb text;

-- Backfill datetime window from the legacy date columns at America/Chicago midnight.
-- end_at is EXCLUSIVE, so the last included day is preserved: end_date + 1 day at
-- 00:00 CT (Camp Hardtner end_date 2026-12-31 → end_at 2027-01-01 00:00 CT, keeping
-- all of Dec 31 in-window exactly as the old ::date <= end_date filter did).
update public.cause_promotions
   set start_at = (start_date::timestamp) at time zone 'America/Chicago',
       end_at   = ((end_date + 1)::timestamp) at time zone 'America/Chicago'
 where start_at is null or end_at is null;

-- ── 2. Capture-at-signup column for POTENTIAL valuation ───────────────────────
-- The exact expected first charge (base + add-on, post-promo-discount) captured
-- from Stripe's upcoming invoice at subscription creation. No local price catalog;
-- realized is always driven off actual settled payments, this only values trials.
alter table public.pending_signups
  add column if not exists expected_first_charge_cents bigint;

-- ── 3. Swap date window for datetime + tighten constraints ────────────────────
-- Views must be dropped first (they reference the columns being removed and their
-- output columns are changing). totals depends on members, so drop totals first.
drop view if exists public.v_cause_promotion_totals;
drop view if exists public.v_cause_promotion_members;

alter table public.cause_promotions
  alter column start_at set not null,
  alter column end_at   set not null,
  drop column if exists start_date,
  drop column if exists end_date,
  add constraint cause_promotions_window_ck check (end_at > start_at),
  -- At least one matching condition — never a rule that matches every subscription.
  add constraint cause_promotions_has_condition_ck check (
    cardinality(qualifying_promo_codes) > 0
    or require_plan_type is not null
    or require_dm_addon  is not null
  );

-- ── 4. Members view: per (promotion, qualifying subscription) with trial/realized
--       state and the two revenue figures kept separate. ───────────────────────
create or replace view public.v_cause_promotion_members
with (security_invoker = true) as
with sub_net as (
  select stripe_subscription_id,
         sum(coalesce(settled_net_cents, 0))    as net_cents,
         sum(coalesce(settled_amount_cents, 0)) as gross_settled_cents,
         count(*)                               as settled_payment_count
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
  ps.stripe_customer_id,
  ps.purchaser_email,
  ps.plan_key,
  case when ps.plan_key = 'individual_monthly' then 'monthly' else 'annual' end as sub_interval,
  ps.promo_code,
  ps.dm_addon,
  ps.status                      as signup_status,
  ps.subscription_created_at,
  coalesce(sn.net_cents, 0)           as realized_net_cents,
  coalesce(sn.gross_settled_cents, 0) as realized_gross_cents,
  -- REALIZED: this sub has at least one settled livemode payment (real money moved).
  (coalesce(sn.settled_payment_count, 0) > 0)                                   as is_realized,
  -- TRIAL/POTENTIAL: matching, live (not cancelled), and not yet charged.
  (coalesce(sn.settled_payment_count, 0) = 0 and ps.status <> 'canceled')       as is_trial,
  -- Potential value: only for in-trial subs, and only while the window is open
  -- (expires to 0 at end_at). Uncaptured expected charge contributes 0, never a guess.
  case
    when coalesce(sn.settled_payment_count, 0) = 0
     and ps.status <> 'canceled'
     and now() < cp.end_at
    then coalesce(ps.expected_first_charge_cents, 0)
    else 0
  end                                                                          as potential_cents
from public.cause_promotions cp
join public.pending_signups ps
  on ps.stripe_subscription_id is not null
  -- Promo is now OPTIONAL: empty qualifying_promo_codes means "no promo requirement".
 and (cardinality(cp.qualifying_promo_codes) = 0 or ps.promo_code = any (cp.qualifying_promo_codes))
 and (cp.require_dm_addon is null or ps.dm_addon = cp.require_dm_addon)
 and (cp.require_plan_type is null
      or cp.require_plan_type = case when ps.plan_key = 'individual_monthly' then 'monthly' else 'annual' end)
  -- MEMBERSHIP window [start_at, end_at): frozen at end_at (no new members after).
 and ps.subscription_created_at is not null
 and ps.subscription_created_at >= cp.start_at
 and ps.subscription_created_at <  cp.end_at
left join sub_net sn on sn.stripe_subscription_id = ps.stripe_subscription_id;

-- ── 5. Totals view: realized vs potential kept separate; payout on realized only.
create or replace view public.v_cause_promotion_totals
with (security_invoker = true) as
select
  cp.id            as promotion_id,
  cp.charity_name,
  cp.payout_rate,
  cp.status,
  cp.start_at,
  cp.end_at,
  cp.customer_facing_enabled,
  cp.public_title,
  cp.public_blurb,
  -- Derived lifecycle phase — no manual "turn it off" step (spec req 2).
  case when now() <  cp.start_at then 'scheduled'
       when now() >= cp.end_at   then 'closed'
       else 'active' end                                            as phase,
  count(m.stripe_subscription_id)                                   as member_subscriptions,
  count(*) filter (where m.is_realized)                             as realized_members,
  count(*) filter (where m.is_trial)                                as trial_members,
  coalesce(sum(m.realized_gross_cents), 0)::bigint                  as realized_gross_cents,
  coalesce(sum(m.realized_net_cents), 0)::bigint                    as realized_net_cents,
  coalesce(sum(m.potential_cents), 0)::bigint                       as potential_cents,
  -- Pledged payout is computed on REALIZED net only — never against money not yet
  -- collected. Ready to write to igy_donation_disbursements at payout time.
  round(coalesce(sum(m.realized_net_cents), 0) * cp.payout_rate)::bigint as payout_cents
from public.cause_promotions cp
left join public.v_cause_promotion_members m on m.promotion_id = cp.id
group by cp.id, cp.charity_name, cp.payout_rate, cp.status, cp.start_at, cp.end_at,
         cp.customer_facing_enabled, cp.public_title, cp.public_blurb;
