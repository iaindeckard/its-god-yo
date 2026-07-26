-- ============================================================================
-- REFERENCE / DOCUMENTATION ONLY — NOT A MIGRATION. DO NOT MOVE TO supabase/migrations/.
-- ============================================================================
--
-- Narrow read-only role on the IGY project (bkwtlfkhfbfyzgnozixw) that the DEI
-- holding-company ETL (pull-igy-reconciliation, in the dei-financial project) uses
-- to read IGY's monthly financials. Mirrors USN's dei_reconciliation_reader.
--
-- WHY THIS IS NOT A MIGRATION (do not "helpfully" relocate it):
--   1. A role + LOGIN belongs to operational provisioning, not schema history. It is
--      applied once, by hand, by Iain — not on every `supabase db push`.
--   2. This role needs a PASSWORD to log in. If this were a migration it would either
--      (a) carry a placeholder password literal — creating a login role with a KNOWN
--      credential that can read IGY financials the moment the migration runs, or
--      (b) create a passwordless login role automatically. Both are hazards. Keeping
--      it out of migrations keeps that credential entirely out of the repo and out of
--      any automated apply.
--
-- THE PASSWORD IS SET OUT-OF-BAND BY IAIN AND NEVER LIVES IN THIS REPO. The role is
-- created below WITHOUT a password (cannot log in until a password is set), and the
-- password is applied separately via a command that is typed by hand and committed
-- nowhere (see the note at the bottom). Same password then goes into the
-- IGY_RECON_DB_URL secret on the dei-financial project — also never in the repo.
--
-- HOW TO USE: run this file's statements once against the IGY project, then set the
-- password out-of-band, then set the IGY_RECON_DB_URL secret and deploy the function.
-- ============================================================================

-- 1) The role. LOGIN so it can connect via the Supavisor pooler; NOBYPASSRLS so it is
--    still subject to row-level security (it sees only what the policy below allows).
--    No password literal here — set out-of-band (see bottom).
create role dei_reconciliation_reader with login nobypassrls;

-- 2) Minimal privileges: connect to the DB, see the schema, read ONLY the one table
--    the ETL reads. No other grants — it cannot read anything else in IGY.
grant connect on database postgres to dei_reconciliation_reader;
grant usage   on schema public    to dei_reconciliation_reader;
grant select  on public.igy_monthly_financials to dei_reconciliation_reader;

-- 3) igy_monthly_financials has RLS ENABLED with zero policies, so without a policy this
--    role would read 0 rows. Add a read-only policy scoped to JUST this role and JUST
--    this table (nothing else on the table changes for any other role).
create policy dei_reader_ro_igy_monthly_financials
  on public.igy_monthly_financials
  for select
  to dei_reconciliation_reader
  using (true);

-- ----------------------------------------------------------------------------
-- OUT-OF-BAND, run by hand, committed NOWHERE (do not paste the password into any
-- file, chat, or commit):
--
--   alter role dei_reconciliation_reader with password '<a strong secret you generate>';
--
-- Then build the Session-pooler connection string (host from the IGY dashboard ->
-- Connect -> Session pooler, port 5432) with user
--   dei_reconciliation_reader.bkwtlfkhfbfyzgnozixw
-- and set it as the ETL secret on the dei-financial project:
--
--   supabase secrets set IGY_RECON_DB_URL="postgresql://dei_reconciliation_reader.bkwtlfkhfbfyzgnozixw:<pw>@<igy-session-pooler-host>:5432/postgres" \
--     --project-ref wctrhcuocpzlytmeiqgs
--   supabase functions deploy pull-igy-reconciliation --project-ref wctrhcuocpzlytmeiqgs
--
-- Rotate later with another `alter role ... with password ...` + `supabase secrets set`.
-- ----------------------------------------------------------------------------
