create table public.outreach_discovery_runs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.outreach_campaigns(id) on delete cascade,
  status text not null default 'running' check (status in ('running','processing','completed','failed')),
  provider text not null default 'openai',
  target_count integer not null check (target_count between 1 and 250),
  max_rounds integer not null default 8 check (max_rounds between 1 and 20),
  round_count integer not null default 0,
  found_count integer not null default 0,
  inserted_count integer not null default 0,
  skipped_count integer not null default 0,
  out_of_radius_count integer not null default 0,
  empty_streak integer not null default 0,
  discovered_names text[] not null default '{}',
  last_error text,
  started_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index outreach_discovery_runs_one_active
  on public.outreach_discovery_runs (campaign_id)
  where status in ('running','processing');
create index outreach_discovery_runs_campaign_recent
  on public.outreach_discovery_runs (campaign_id, started_at desc);

alter table public.outreach_discovery_runs enable row level security;
revoke all on table public.outreach_discovery_runs from anon, authenticated;
grant select, insert, update, delete on table public.outreach_discovery_runs to service_role;

comment on table public.outreach_discovery_runs is
  'Service-role-only resumable progress ledger for campaign church discovery.';
