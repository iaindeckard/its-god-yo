alter table public.consent_log drop constraint if exists consent_log_consent_type_check;
alter table public.consent_log add constraint consent_log_consent_type_check
  check (consent_type = any (array['primary_subscriber'::text, 'plus_one_gift'::text, 'family_teen'::text]));
