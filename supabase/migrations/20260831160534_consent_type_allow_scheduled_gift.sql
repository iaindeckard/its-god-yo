-- Add 'scheduled_gift' to consent_log.consent_type (same drop/re-add pattern used for family_teen).
-- Lets the Christmas prepaid recipient's consent row be queried/reported distinctly from the
-- immediate Gift path. Existing allowed values preserved verbatim.
alter table public.consent_log drop constraint if exists consent_log_consent_type_check;
alter table public.consent_log add constraint consent_log_consent_type_check
  check (consent_type = any (array['primary_subscriber'::text, 'plus_one_gift'::text, 'family_teen'::text, 'scheduled_gift'::text]));
