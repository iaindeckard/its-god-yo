-- Delayed-billing signup handoff. Holds the chosen plan + saved (uncharged)
-- payment method (from a SetupIntent) + referral, linked to consent_log row(s).
-- The subscription is created later, only after the teen confirms via SMS.
CREATE TABLE IF NOT EXISTS public.pending_signups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  language text NOT NULL CHECK (language = ANY (ARRAY['en','es'])),
  plan_key text NOT NULL,
  base_price_id text NOT NULL,
  group_teen_count integer,
  dm_addon boolean NOT NULL DEFAULT false,
  dm_addon_price_id text,
  referral_code text,
  referral_discount_applied boolean NOT NULL DEFAULT false,
  purchaser_email text,
  purchaser_user_id uuid REFERENCES auth.users(id),
  teen_consent_id uuid NOT NULL REFERENCES public.consent_log(id),
  plus_one_consent_id uuid REFERENCES public.consent_log(id),
  stripe_customer_id text,
  stripe_setup_intent_id text,
  stripe_payment_method_id text,
  status text NOT NULL DEFAULT 'awaiting_confirmation'
    CHECK (status = ANY (ARRAY['awaiting_confirmation','confirmed','subscription_created','expired','canceled'])),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pending_signups ENABLE ROW LEVEL SECURITY;
-- No policies: service-role only (same posture as consent_log).
