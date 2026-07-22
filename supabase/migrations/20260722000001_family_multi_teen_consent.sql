alter table public.consent_log
  add column if not exists pending_signup_id uuid references public.pending_signups(id) on delete set null,
  add column if not exists trial_ends_at timestamptz,
  add column if not exists teen_index integer;
create index if not exists idx_consent_log_pending_signup on public.consent_log(pending_signup_id);
create index if not exists idx_consent_log_family_trial
  on public.consent_log(pending_signup_id, consent_status, trial_ends_at) where consent_type = 'family_teen';
