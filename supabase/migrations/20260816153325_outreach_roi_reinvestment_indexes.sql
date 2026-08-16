create index if not exists idx_outreach_campaigns_reinvestment_source
  on public.outreach_campaigns(reinvestment_source_campaign_id)
  where reinvestment_source_campaign_id is not null;

create index if not exists idx_outreach_reinvestment_allocations_source
  on public.outreach_reinvestment_allocations(source_campaign_id);
