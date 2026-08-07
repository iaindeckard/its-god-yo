-- Outreach net-revenue (Phase 4b). Extends the Phase 3 leaderboard views with
-- net_revenue_cents: realized net per converting church via the redeemed code ->
-- subscription -> settled balance transactions. Mirrors the cause_promotions
-- pattern. settled_net_cents already nets Stripe fees, refunds, and chargebacks
-- and accrues over renewals, so this is the living realized-net figure (vs the
-- first-charge revenue_cents kept alongside it). NO new columns on base tables.
--
-- FAN-OUT GUARD: net is aggregated PER LEAD in the lead_net CTE (one row per
-- lead) before being joined back, so the lead COUNTS in the outer query are never
-- multiplied by the number of payment rows. Also exposes the campaign's
-- discount_percent + message_variant on the campaign view for the leaderboard's
-- Offer column. Legacy (campaign_id null) leads remain excluded by design.

-- Join indexes for the net path (confirmed missing 2026-08-07).
create index if not exists idx_leads_promo_promotion_code_id
  on public.igy_outreach_leads (promo_promotion_code_id) where promo_promotion_code_id is not null;
create index if not exists idx_pending_signups_promo_promotion_code_id
  on public.pending_signups (promo_promotion_code_id) where promo_promotion_code_id is not null;

drop view if exists public.v_outreach_campaign_performance;
create view public.v_outreach_campaign_performance
with (security_invoker = true) as
with lead_net as (
  -- realized net per lead: its unique redeemed code -> pending_signup -> subscription -> livemode balance txns
  select l.id as lead_id, coalesce(sum(sp.settled_net_cents), 0)::bigint as net_cents
  from public.igy_outreach_leads l
  join public.pending_signups ps on ps.promo_promotion_code_id = l.promo_promotion_code_id
  join public.subscription_payments sp
    on sp.stripe_subscription_id = ps.stripe_subscription_id and sp.livemode = true
  where l.promo_promotion_code_id is not null
  group by l.id
)
select
  c.id           as campaign_id,
  c.name,
  c.center_label as region,
  c.radius_miles,
  c.size_filter,
  c.status,
  c.discount_percent,
  c.message_variant,
  count(l.id)                                                                      as total_leads,
  count(l.id) filter (where l.send_count > 0)                                      as contacted,
  count(l.id) filter (where l.send_count >= 2)                                     as offer_sent,
  count(l.id) filter (where l.status = 'converted')                               as redeemed,
  coalesce(sum(l.conversion_value_cents) filter (where l.status = 'converted'), 0)::bigint as revenue_cents,
  coalesce(sum(ln.net_cents), 0)::bigint                                          as net_revenue_cents,
  round(100.0 * count(l.id) filter (where l.status = 'converted')
        / nullif(count(l.id) filter (where l.send_count > 0), 0), 1)               as conversion_pct,
  round(100.0 * count(l.id) filter (where l.status = 'converted')
        / nullif(count(l.id) filter (where l.send_count >= 2), 0), 1)              as redeemed_of_offered_pct
from public.outreach_campaigns c
left join public.igy_outreach_leads l on l.campaign_id = c.id
left join lead_net ln on ln.lead_id = l.id
group by c.id, c.name, c.center_label, c.radius_miles, c.size_filter, c.status, c.discount_percent, c.message_variant;

drop view if exists public.v_outreach_campaign_size_performance;
create view public.v_outreach_campaign_size_performance
with (security_invoker = true) as
with lead_net as (
  select l.id as lead_id, coalesce(sum(sp.settled_net_cents), 0)::bigint as net_cents
  from public.igy_outreach_leads l
  join public.pending_signups ps on ps.promo_promotion_code_id = l.promo_promotion_code_id
  join public.subscription_payments sp
    on sp.stripe_subscription_id = ps.stripe_subscription_id and sp.livemode = true
  where l.promo_promotion_code_id is not null
  group by l.id
)
select
  c.id           as campaign_id,
  c.name,
  c.center_label as region,
  l.size_bucket,
  count(l.id) filter (where l.send_count > 0)                                      as contacted,
  count(l.id) filter (where l.send_count >= 2)                                     as offer_sent,
  count(l.id) filter (where l.status = 'converted')                               as redeemed,
  coalesce(sum(l.conversion_value_cents) filter (where l.status = 'converted'), 0)::bigint as revenue_cents,
  coalesce(sum(ln.net_cents), 0)::bigint                                          as net_revenue_cents,
  round(100.0 * count(l.id) filter (where l.status = 'converted')
        / nullif(count(l.id) filter (where l.send_count > 0), 0), 1)               as conversion_pct
from public.outreach_campaigns c
join public.igy_outreach_leads l on l.campaign_id = c.id
left join lead_net ln on ln.lead_id = l.id
group by c.id, c.name, c.center_label, l.size_bucket;
