-- Solo-operator task-notification system (LOCKED spec 2026-08-06): shared alert
-- state for Tier 2 (email dedup-until-recovered) and Tier 3 (SMS 4h cooldown per
-- alert-type + affected-entity, reset on resolution). One row per (alert_type,
-- entity_key). Service-role only (RLS on, no public policies).

create table if not exists public.igy_alert_state (
  alert_type   text        not null,
  entity_key   text        not null default '',
  last_fired_at timestamptz,
  fire_count   integer     not null default 0,
  -- Starts true so the very first occurrence of any (type, entity) fires. Set
  -- false when we fire, back true when the underlying condition is resolved.
  resolved     boolean     not null default true,
  resolved_at  timestamptz,
  last_message text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (alert_type, entity_key)
);

alter table public.igy_alert_state enable row level security;
-- No policies on purpose: only the service-role client touches this table.

-- Atomically decide whether an alert should fire, and if so stamp it. Race-safe:
-- the fire decision and the stamp are a single INSERT ... ON CONFLICT statement, so
-- two concurrent callers can never both get `true`.
--
-- Fires when: never seen before, OR the condition was resolved since last fire
-- (fresh episode), OR it is still unresolved but the cooldown has elapsed (a
-- reminder that it is STILL broken). p_cooldown_ms = null means "never re-fire
-- while unresolved" (Tier 2 email: one alert per episode until runway recovers).
create or replace function public.claim_alert(
  p_type text,
  p_key text,
  p_cooldown_ms bigint,
  p_message text default null
) returns boolean
language plpgsql
as $$
declare
  v_fired boolean;
begin
  insert into public.igy_alert_state as s
    (alert_type, entity_key, last_fired_at, fire_count, resolved, resolved_at, last_message, updated_at)
  values
    (p_type, coalesce(p_key, ''), now(), 1, false, null, p_message, now())
  on conflict (alert_type, entity_key) do update
    set last_fired_at = now(),
        fire_count     = s.fire_count + 1,
        resolved       = false,
        resolved_at    = null,
        last_message   = coalesce(excluded.last_message, s.last_message),
        updated_at     = now()
    where s.resolved = true
       or s.last_fired_at is null
       or (p_cooldown_ms is not null
           and extract(epoch from (now() - s.last_fired_at)) * 1000 >= p_cooldown_ms)
  returning true into v_fired;
  -- No row returned means the ON CONFLICT WHERE was false (suppressed).
  return coalesce(v_fired, false);
end;
$$;

-- Mark a (type, entity) resolved so the next occurrence fires immediately instead
-- of waiting out a stale cooldown. No-op if there is no row or it is already
-- resolved. Returns whether a row transitioned unresolved -> resolved.
create or replace function public.resolve_alert(
  p_type text,
  p_key text
) returns boolean
language plpgsql
as $$
declare
  v_rows integer;
begin
  update public.igy_alert_state
    set resolved = true, resolved_at = now(), updated_at = now()
  where alert_type = p_type
    and entity_key = coalesce(p_key, '')
    and resolved = false;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

revoke all on function public.claim_alert(text, text, bigint, text) from public, anon, authenticated;
revoke all on function public.resolve_alert(text, text) from public, anon, authenticated;
