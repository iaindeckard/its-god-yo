-- Campaign-owned outreach releases. A campaign is only sendable after a human
-- schedules an exact recipient snapshot. The cron polls for due releases; it
-- does not invent dates, approve copy, promote leads, or open the global gate.

alter table public.outreach_campaigns
  drop constraint if exists outreach_campaigns_status_check;

alter table public.outreach_campaigns
  add constraint outreach_campaigns_status_check
  check (status in ('draft','discovering','ready','scheduled','sending','active','completed','paused','archived'));

alter table public.outreach_campaigns
  add column if not exists release_at timestamptz,
  add column if not exists release_timezone text,
  add column if not exists scheduled_at timestamptz,
  add column if not exists scheduled_by uuid,
  add column if not exists schedule_snapshot jsonb,
  add column if not exists release_started_at timestamptz,
  add column if not exists release_completed_at timestamptz,
  add column if not exists last_release_report jsonb;

create index if not exists idx_outreach_campaigns_due_release
  on public.outreach_campaigns (release_at)
  where status = 'scheduled' and release_at is not null;

comment on column public.outreach_campaigns.schedule_snapshot is
  'Immutable-at-schedule-time review record: exact lead ids, approved template variant, offer, and scheduler.';

create table if not exists public.outreach_campaign_deliveries (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.outreach_campaigns(id) on delete cascade,
  lead_id uuid not null references public.igy_outreach_leads(id) on delete cascade,
  touch smallint not null check (touch in (1, 2)),
  status text not null default 'claimed' check (status in ('claimed','sent','failed')),
  claim_token uuid not null,
  provider_message_id text,
  error text,
  claimed_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (campaign_id, lead_id, touch)
);

create index if not exists idx_outreach_campaign_deliveries_lead
  on public.outreach_campaign_deliveries (lead_id);

alter table public.outreach_campaign_deliveries enable row level security;

revoke all on table public.outreach_campaign_deliveries from anon, authenticated;
grant select, insert, update, delete on table public.outreach_campaign_deliveries to service_role;

comment on table public.outreach_campaign_deliveries is
  'Service-role-only idempotency and audit ledger for scheduled campaign sends.';
