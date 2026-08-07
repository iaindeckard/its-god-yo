-- Outreach performance leaderboard (Phase 3 of the approved architecture).
-- Two read-only views over the Phase 1 schema — NO new columns. Rates-first,
-- region (= campaign) x size cross-tab. Conversion is already denormalized onto
-- the lead by the Phase 1 Stripe webhook (status='converted' + conversion_value_cents),
-- so no promo/subscription join is needed for the headline metrics.
--
-- Metric definitions (locked 2026-08-07):
--   contacted  = send_count > 0            (reached at all)
--   offer_sent = send_count >= 2           (the coded email-2 actually went out)
--   redeemed   = status = 'converted'
--   revenue    = sum(conversion_value_cents) over converted   [FIRST CHARGE basis;
--                the Phase 4 net-revenue join is deliberately deferred]
--   conversion_pct          = redeemed / contacted   (headline; null when contacted=0)
--   redeemed_of_offered_pct = redeemed / offer_sent  (secondary; null when offer_sent=0)
--
-- Legacy/global-cron leads (campaign_id IS NULL) are intentionally excluded — the
-- leaderboard is about campaigns. security_invoker=true matches the cause_promotions
-- and cornerstone views; both are read via the service-role admin client.

create or replace view public.v_outreach_campaign_performance
with (security_invoker = true) as
select
  c.id           as campaign_id,
  c.name,
  c.center_label as region,
  c.radius_miles,
  c.size_filter,
  c.status,
  count(l.id)                                                                      as total_leads,
  count(l.id) filter (where l.send_count > 0)                                      as contacted,
  count(l.id) filter (where l.send_count >= 2)                                     as offer_sent,
  count(l.id) filter (where l.status = 'converted')                               as redeemed,
  coalesce(sum(l.conversion_value_cents) filter (where l.status = 'converted'), 0)::bigint as revenue_cents,
  round(100.0 * count(l.id) filter (where l.status = 'converted')
        / nullif(count(l.id) filter (where l.send_count > 0), 0), 1)               as conversion_pct,
  round(100.0 * count(l.id) filter (where l.status = 'converted')
        / nullif(count(l.id) filter (where l.send_count >= 2), 0), 1)              as redeemed_of_offered_pct
from public.outreach_campaigns c
left join public.igy_outreach_leads l on l.campaign_id = c.id
group by c.id, c.name, c.center_label, c.radius_miles, c.size_filter, c.status;

create or replace view public.v_outreach_campaign_size_performance
with (security_invoker = true) as
select
  c.id           as campaign_id,
  c.name,
  c.center_label as region,
  l.size_bucket,
  count(l.id) filter (where l.send_count > 0)                                      as contacted,
  count(l.id) filter (where l.send_count >= 2)                                     as offer_sent,
  count(l.id) filter (where l.status = 'converted')                               as redeemed,
  coalesce(sum(l.conversion_value_cents) filter (where l.status = 'converted'), 0)::bigint as revenue_cents,
  round(100.0 * count(l.id) filter (where l.status = 'converted')
        / nullif(count(l.id) filter (where l.send_count > 0), 0), 1)               as conversion_pct
from public.outreach_campaigns c
join public.igy_outreach_leads l on l.campaign_id = c.id
group by c.id, c.name, c.center_label, l.size_bucket;
