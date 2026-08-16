alter table public.outreach_campaigns
  add column if not exists denomination_filter text[];

comment on column public.outreach_campaigns.denomination_filter is
  'Official church-directory IDs selected for discovery. NULL or empty means all configured directories plus the secondary-web fallback.';
