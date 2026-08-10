-- ROI growth program: privacy-conscious funnel analytics, activation status,
-- feature-flagged freemium state, pilot recruitment, and verified social proof.

create table public.conversion_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid,
  event_name text not null check (event_name in (
    'landing_view','audience_selected','sample_viewed','signup_started',
    'focus_selected','plan_selected','recipient_completed','payment_saved',
    'consent_sent','consent_confirmed','subscription_activated',
    'first_message_delivered','referral_shared','church_interest_submitted',
    'freemium_started','freemium_upgraded','freemium_weekly_transition',
    'cancelled','opted_out'
  )),
  page_path text,
  audience text check (audience is null or audience in ('parent','teen','church')),
  plan_key text,
  acquisition_source text,
  acquisition_medium text,
  acquisition_campaign text,
  pending_signup_id uuid references public.pending_signups(id) on delete set null,
  properties jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint conversion_events_properties_object check (jsonb_typeof(properties) = 'object')
);

create index conversion_events_name_time_idx on public.conversion_events(event_name, occurred_at desc);
create index conversion_events_session_time_idx on public.conversion_events(session_id, occurred_at);
create index conversion_events_signup_idx on public.conversion_events(pending_signup_id) where pending_signup_id is not null;
alter table public.conversion_events enable row level security;
revoke all on public.conversion_events from anon, authenticated;
grant select, insert, update, delete on public.conversion_events to service_role;

create table public.signup_status_tokens (
  id uuid primary key default gen_random_uuid(),
  pending_signup_id uuid not null references public.pending_signups(id) on delete cascade,
  token uuid not null default gen_random_uuid() unique,
  expires_at timestamptz not null default (now() + interval '30 days'),
  reminder_count integer not null default 0 check (reminder_count between 0 and 2),
  last_reminder_at timestamptz,
  created_at timestamptz not null default now(),
  unique (pending_signup_id)
);
alter table public.signup_status_tokens enable row level security;
revoke all on public.signup_status_tokens from anon, authenticated;
grant select, insert, update, delete on public.signup_status_tokens to service_role;

alter table public.consent_log
  add column if not exists access_tier text not null default 'paid_daily'
    check (access_tier in ('paid_daily','free_daily_trial','free_weekly')),
  add column if not exists free_trial_started_at timestamptz,
  add column if not exists free_trial_ends_at timestamptz,
  add column if not exists weekly_send_dow smallint check (weekly_send_dow between 0 and 6),
  add column if not exists freemium_transitioned_at timestamptz,
  add column if not exists freemium_upgraded_at timestamptz;

create table public.pilot_interest (
  id uuid primary key default gen_random_uuid(),
  audience_type text not null check (audience_type in ('family','church')),
  contact_name text not null,
  contact_email text not null,
  organization_name text,
  estimated_recipients integer check (estimated_recipients is null or estimated_recipients between 1 and 250),
  source text,
  status text not null default 'new' check (status in ('new','contacted','qualified','enrolled','declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.pilot_interest enable row level security;
revoke all on public.pilot_interest from anon, authenticated;
grant select, insert, update, delete on public.pilot_interest to service_role;

create table public.social_proof_items (
  id uuid primary key default gen_random_uuid(),
  proof_type text not null check (proof_type in ('testimonial','metric','church','case_study')),
  headline text not null,
  body text,
  attribution text,
  evidence_note text not null,
  consent_confirmed_at timestamptz,
  verified_at timestamptz,
  published boolean not null default false,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_proof_publish_gate check (not published or (verified_at is not null and (proof_type <> 'testimonial' or consent_confirmed_at is not null)))
);
alter table public.social_proof_items enable row level security;
revoke all on public.social_proof_items from anon, authenticated;
grant select, insert, update, delete on public.social_proof_items to service_role;
