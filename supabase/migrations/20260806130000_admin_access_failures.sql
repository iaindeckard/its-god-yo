-- Tier 3 security signal (LOCKED 2026-08-06): log of authenticated-but-denied
-- admin access attempts (requirePermission ForbiddenError). Repeated failures by
-- one principal in a short window trip a Tier 3 SMS. Anonymous/no-session hits are
-- deliberately NOT logged here (far too noisy to be a signal). Service-role only.

create table if not exists public.igy_admin_access_failures (
  id             uuid        primary key default gen_random_uuid(),
  principal      text        not null,        -- auth user id that was denied
  permission_key text,                        -- the permission it was denied
  created_at     timestamptz not null default now()
);

create index if not exists igy_admin_access_failures_principal_time
  on public.igy_admin_access_failures (principal, created_at desc);

alter table public.igy_admin_access_failures enable row level security;
-- No policies on purpose: only the service-role client reads/writes this table.
