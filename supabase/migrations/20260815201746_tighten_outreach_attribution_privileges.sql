-- Supabase default privileges granted service_role more capabilities than the
-- Phase 1 migration intended. Narrow the live objects to their actual server use.
-- Public, anon, and authenticated were already fully revoked.

revoke all on table public.outreach_attribution_sessions from service_role;
grant select, insert, update, delete on table public.outreach_attribution_sessions to service_role;

revoke all on table public.v_outreach_payment_attribution from service_role;
grant select on table public.v_outreach_payment_attribution to service_role;
