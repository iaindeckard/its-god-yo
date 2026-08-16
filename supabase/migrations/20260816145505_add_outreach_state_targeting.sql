alter table public.outreach_campaigns
  add column if not exists geography_type text not null default 'radius',
  add column if not exists state_code text;

alter table public.outreach_campaigns
  drop constraint if exists outreach_campaigns_geography_type_check;

alter table public.outreach_campaigns
  add constraint outreach_campaigns_geography_type_check
  check (geography_type in ('radius', 'state'));

alter table public.outreach_campaigns
  drop constraint if exists outreach_campaigns_state_target_check;

alter table public.outreach_campaigns
  add constraint outreach_campaigns_state_target_check
  check (
    (geography_type = 'radius' and state_code is null)
    or
    (geography_type = 'state' and state_code ~ '^[A-Z]{2}$')
  );

comment on column public.outreach_campaigns.geography_type is
  'Candidate geography boundary: a center/radius or an entire US state.';
comment on column public.outreach_campaigns.state_code is
  'Two-letter US state code when geography_type is state.';
