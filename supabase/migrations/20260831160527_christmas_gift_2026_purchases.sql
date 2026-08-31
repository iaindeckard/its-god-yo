-- Christmas Scheduled Gift 2026 — one row per prepaid gift purchase.
-- Deliberately NOT the pending_signups/SetupIntent path: a one-time PaymentIntent is charged
-- immediately at checkout; NO Stripe subscription is ever created (locked decision #3). The
-- subscriber's pending_signups + consent_log rows are created LATER, at recipient confirmation.
-- list_price_cents + charged_amount_cents are BOTH stored so a discounted flash-sale purchase
-- stays auditable against the price it was discounted from. Posture: RLS enabled, NO policies
-- => service-role only.
CREATE TABLE IF NOT EXISTS public.christmas_gift_2026_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Purchaser (the gift buyer)
  purchaser_email          text NOT NULL,
  purchaser_first_name     text,
  purchaser_last_name      text,
  purchaser_salutation     text[],                                  -- reuse pending_signups.purchaser_salutation pattern
  purchaser_user_id        uuid REFERENCES auth.users(id),
  stripe_customer_id       text NOT NULL,                           -- balance-credit target on non-confirmation
  stripe_payment_intent_id text NOT NULL,                           -- the one-time charge

  -- Gifter identity for the recipient-facing SMS (reuse consent_log.gifter_* naming)
  gifter_first_name        text,
  gifter_last_name         text,
  gifter_honorific         text,
  gifter_relationship      text,

  -- Recipient
  recipient_first_name     text,
  recipient_phone          text NOT NULL,
  language                 text NOT NULL CHECK (language = ANY (ARRAY['en','es'])),
  recipient_birth_year     integer,                                 -- feeds the existing age gate at release
  recipient_country_code   text,

  -- Pricing / window (both amounts stored for audit)
  list_price_cents         integer NOT NULL,
  charged_amount_cents     integer NOT NULL,
  purchase_window          text NOT NULL
                             CHECK (purchase_window = ANY (ARRAY['early_bird','flash_sale','standard'])),
  dmfh_bonus_included      boolean NOT NULL DEFAULT false,
  livemode                 boolean NOT NULL DEFAULT true,           -- mirror subscription_payments; excludes test-clock

  -- Scheduling
  release_at               date NOT NULL,                          -- buyer-chosen; confirmation text goes out on/after

  -- Lifecycle
  status                   text NOT NULL DEFAULT 'awaiting_release'
                             CHECK (status = ANY (ARRAY['awaiting_release','confirmation_sent','confirmed','credited','canceled'])),
  confirmation_sent_at     timestamptz,                            -- release-day send; day-0 of the 30-day ceiling
  confirmation_resent_at   timestamptz,                            -- the single day-7 resend
  consent_log_id           uuid REFERENCES public.consent_log(id), -- set when the confirmation text sends
  pending_signup_id        uuid REFERENCES public.pending_signups(id), -- set at confirmation (subscriber row, no Stripe sub)
  confirmed_at             timestamptz,                            -- recipient YES; anchors the 1-year service period

  -- Referral attribution (link lives on referral_events; code kept here for record)
  referral_code            text,

  -- Non-confirmation => Stripe customer-balance credit (reuses the igy_bounty_credits mechanism)
  credit_issued_at         timestamptz,
  credit_amount_cents      integer,
  stripe_balance_transaction_id text,
  credit_skipped_reason    text,

  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- One purchase per PaymentIntent (idempotency for the webhook capture + checkout retries).
CREATE UNIQUE INDEX IF NOT EXISTS christmas_gift_2026_purchases_pi_uq
  ON public.christmas_gift_2026_purchases (stripe_payment_intent_id);
CREATE INDEX IF NOT EXISTS christmas_gift_2026_purchases_status
  ON public.christmas_gift_2026_purchases (status);
-- Release-day cron hot path: due rows still awaiting their scheduled send.
CREATE INDEX IF NOT EXISTS christmas_gift_2026_purchases_due_release
  ON public.christmas_gift_2026_purchases (release_at) WHERE status = 'awaiting_release';

ALTER TABLE public.christmas_gift_2026_purchases ENABLE ROW LEVEL SECURITY;
-- No policies: service-role only.
