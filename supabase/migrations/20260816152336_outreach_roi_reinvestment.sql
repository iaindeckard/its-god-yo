-- Approval-gated ROI reinvestment. The weekly job proposes allocations from
-- realized net revenue; it never schedules or sends outreach. An authorized
-- approval materializes draft campaigns with immutable allocated budgets.

alter table public.outreach_campaigns
  add column if not exists investment_cents bigint not null default 0 check (investment_cents >= 0),
  add column if not exists allocated_budget_cents bigint not null default 0 check (allocated_budget_cents >= 0),
  add column if not exists reinvested_net_revenue_cents bigint not null default 0 check (reinvested_net_revenue_cents >= 0),
  add column if not exists reinvestment_source_campaign_id uuid references public.outreach_campaigns(id) on delete set null;

create table if not exists public.outreach_reinvestment_policy (
  id boolean primary key default true check (id),
  enabled boolean not null default true,
  reinvest_rate_bps integer not null default 3000 check (reinvest_rate_bps between 0 and 10000),
  minimum_contacted integer not null default 20 check (minimum_contacted >= 1),
  minimum_conversions integer not null default 2 check (minimum_conversions >= 1),
  minimum_roi_bps integer not null default 1000,
  maximum_cycle_cents bigint not null default 50000 check (maximum_cycle_cents >= 0),
  maximum_campaign_share_bps integer not null default 5000 check (maximum_campaign_share_bps between 1 and 10000),
  updated_by uuid,
  updated_at timestamptz not null default now()
);

insert into public.outreach_reinvestment_policy (id) values (true) on conflict (id) do nothing;

create table if not exists public.outreach_reinvestment_proposals (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  status text not null default 'proposed' check (status in ('proposed','approved','executing','executed','rejected')),
  policy_snapshot jsonb not null,
  evidence_snapshot jsonb not null,
  realized_net_revenue_cents bigint not null check (realized_net_revenue_cents >= 0),
  proposed_reinvestment_cents bigint not null check (proposed_reinvestment_cents >= 0),
  created_by uuid,
  created_at timestamptz not null default now(),
  approved_by uuid,
  approved_at timestamptz,
  rejected_by uuid,
  rejected_at timestamptz,
  executed_at timestamptz,
  execution_error text,
  unique (period_start, period_end)
);

create table if not exists public.outreach_reinvestment_allocations (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.outreach_reinvestment_proposals(id) on delete restrict,
  source_campaign_id uuid not null references public.outreach_campaigns(id) on delete restrict,
  source_campaign_name text not null,
  invested_cents bigint not null check (invested_cents > 0),
  net_revenue_cents bigint not null check (net_revenue_cents >= 0),
  newly_realized_net_cents bigint not null check (newly_realized_net_cents > 0),
  profit_cents bigint not null check (profit_cents > 0),
  roi_bps integer not null,
  contacted integer not null,
  conversions integer not null,
  allocated_cents bigint not null check (allocated_cents > 0),
  created_campaign_id uuid references public.outreach_campaigns(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (proposal_id, source_campaign_id),
  unique (created_campaign_id)
);

alter table public.outreach_campaigns
  add column if not exists reinvestment_proposal_id uuid references public.outreach_reinvestment_proposals(id) on delete set null;

create unique index if not exists outreach_campaigns_one_reinvestment_draft
  on public.outreach_campaigns(reinvestment_proposal_id, reinvestment_source_campaign_id)
  where reinvestment_proposal_id is not null and reinvestment_source_campaign_id is not null;

create index if not exists idx_outreach_reinvestment_proposals_status
  on public.outreach_reinvestment_proposals(status, created_at desc);
create index if not exists idx_outreach_reinvestment_allocations_proposal
  on public.outreach_reinvestment_allocations(proposal_id);

alter table public.outreach_reinvestment_policy enable row level security;
alter table public.outreach_reinvestment_proposals enable row level security;
alter table public.outreach_reinvestment_allocations enable row level security;
revoke all on public.outreach_reinvestment_policy from anon, authenticated;
revoke all on public.outreach_reinvestment_proposals from anon, authenticated;
revoke all on public.outreach_reinvestment_allocations from anon, authenticated;
grant select, insert, update, delete on public.outreach_reinvestment_policy to service_role;
grant select, insert, update, delete on public.outreach_reinvestment_proposals to service_role;
grant select, insert, update, delete on public.outreach_reinvestment_allocations to service_role;

insert into public.permissions (key, label, category) values
  ('marketing.outreach.reinvestment.approve', 'Approve ROI reinvestment allocations', 'marketing')
on conflict (key) do update set label = excluded.label, category = excluded.category;

insert into public.role_permissions (job_role, permission_key, enabled)
select r.key, 'marketing.outreach.reinvestment.approve', r.key = 'super_admin'
from public.staff_job_roles r
on conflict (job_role, permission_key) do update set enabled = excluded.enabled;

comment on table public.outreach_reinvestment_proposals is
  'Immutable ROI evidence and proposed allocation per weekly period. Approval is separate from execution and never authorizes scheduling or sending.';
