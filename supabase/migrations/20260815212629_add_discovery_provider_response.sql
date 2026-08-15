alter table public.outreach_discovery_runs
  add column provider_response_id text,
  add column provider_status text;

comment on column public.outreach_discovery_runs.provider_response_id is
  'OpenAI background Response ID for the active discovery round.';

comment on column public.outreach_discovery_runs.provider_status is
  'Last observed OpenAI background Response status.';
