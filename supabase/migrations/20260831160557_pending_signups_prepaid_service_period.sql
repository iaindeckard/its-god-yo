-- Prepaid gifted-year support on the subscriber row + widen the daily-send audience.
--
-- A confirmed Christmas recipient becomes a subscriber with NO Stripe subscription (locked
-- decision #3). Two new columns carry the "one gifted year" that a subscription lifecycle would
-- otherwise provide:
--   service_period_end  -- delivery-authoritative window end; the daily-send view honors it
--   dm_addon_free_until -- scopes the FREE DM-from-Him bonus to the gifted year (render path,
--                          Phase 3, will read this alongside dm_addon; column added now)
-- New status 'prepaid_active' marks these subscription-less-but-live rows. Existing 8 live status
-- values preserved verbatim (repo migration was drifted; taken from the live constraint).
ALTER TABLE public.pending_signups
  ADD COLUMN IF NOT EXISTS service_period_end  timestamptz,
  ADD COLUMN IF NOT EXISTS dm_addon_free_until timestamptz;

ALTER TABLE public.pending_signups DROP CONSTRAINT IF EXISTS pending_signups_status_check;
ALTER TABLE public.pending_signups ADD CONSTRAINT pending_signups_status_check
  CHECK (status = ANY (ARRAY[
    'awaiting_confirmation','confirmed','subscription_created','active',
    'past_due','requires_action','expired','canceled','prepaid_active'
  ]));

-- Widen daily_send_audience to admit prepaid Scheduled Gift recipients within their gifted year.
-- Two disjoint eligibility branches; the prepaid branch requires NO stripe_subscription_id and is
-- gated on plan_key + a live service_period_end so it self-expires at year end. Column list and the
-- subscription branch are unchanged from 20260731163734.
CREATE OR REPLACE VIEW public.daily_send_audience AS
 SELECT DISTINCT ON (c.id) c.id AS consent_id,
    p.id AS pending_signup_id,
    c.recipient_phone,
    c.recipient_first_name,
    c.language,
    p.theme_track,
    p.stripe_subscription_id,
    COALESCE(c.send_time_local, '12:00:00'::time without time zone) AS send_time_local,
    COALESCE(NULLIF(c.timezone, ''::text), NULLIF(p.purchaser_timezone, ''::text),
        CASE upper(c.recipient_country_code)
            WHEN 'US'::text THEN 'America/Chicago'::text
            WHEN 'MX'::text THEN 'America/Mexico_City'::text
            WHEN 'CA'::text THEN 'America/Toronto'::text
            ELSE NULL::text
        END, 'America/Chicago'::text) AS timezone,
    c.confirmation_reply_at AS confirmed_at
   FROM consent_log c
     JOIN pending_signups p ON p.id = c.pending_signup_id OR p.teen_consent_id = c.id OR p.plus_one_consent_id = c.id
  WHERE c.consent_status = 'confirmed'::text
    AND (
      (p.status IN ('subscription_created'::text, 'active'::text) AND p.stripe_subscription_id IS NOT NULL)
      OR
      (p.status = 'prepaid_active'::text AND p.plan_key = 'christmas_gift_2026'::text
         AND p.service_period_end IS NOT NULL AND p.service_period_end > now())
    )
  ORDER BY c.id, p.created_at DESC, p.id;

COMMENT ON VIEW public.daily_send_audience IS
  'Daily-send eligibility. Branch 1 (subscription): consent confirmed + status IN (subscription_created, active) + stripe_subscription_id set. Branch 2 (prepaid Christmas gift): consent confirmed + status=prepaid_active + plan_key=christmas_gift_2026 + service_period_end in the future (NO Stripe subscription, self-expires at gifted-year end). Excludes canceled/past_due/requires_action.';
