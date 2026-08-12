-- Persist Resend's complete outbound delivery lifecycle. The scheduler ledger is
-- authoritative for application release; signed webhook events add provider and
-- recipient-mail-server outcomes without exposing any data to browser roles.

alter table public.outreach_campaign_deliveries
  drop constraint if exists outreach_campaign_deliveries_status_check;

alter table public.outreach_campaign_deliveries
  add constraint outreach_campaign_deliveries_status_check
  check (status in ('claimed','sent','delivered','delayed','bounced','complained','suppressed','failed'));

alter table public.outreach_campaign_deliveries
  add column if not exists delivered_at timestamptz,
  add column if not exists delayed_at timestamptz,
  add column if not exists bounced_at timestamptz,
  add column if not exists complained_at timestamptz,
  add column if not exists suppressed_at timestamptz,
  add column if not exists last_event_at timestamptz,
  add column if not exists last_event_type text;

create unique index if not exists idx_outreach_deliveries_provider_message
  on public.outreach_campaign_deliveries (provider_message_id)
  where provider_message_id is not null;

create table if not exists public.outreach_delivery_events (
  id uuid primary key default gen_random_uuid(),
  provider_event_id text not null unique,
  provider_message_id text,
  event_type text not null,
  occurred_at timestamptz not null,
  delivery_id uuid references public.outreach_campaign_deliveries(id) on delete set null,
  payload jsonb not null,
  received_at timestamptz not null default now()
);

create index if not exists idx_outreach_delivery_events_message
  on public.outreach_delivery_events (provider_message_id, occurred_at desc);

create index if not exists idx_outreach_delivery_events_delivery
  on public.outreach_delivery_events (delivery_id, occurred_at desc)
  where delivery_id is not null;

alter table public.outreach_delivery_events enable row level security;
revoke all on table public.outreach_delivery_events from anon, authenticated;
grant select, insert, update, delete on table public.outreach_delivery_events to service_role;

comment on table public.outreach_delivery_events is
  'Service-role-only immutable Resend webhook audit events, deduplicated by Svix event id.';
