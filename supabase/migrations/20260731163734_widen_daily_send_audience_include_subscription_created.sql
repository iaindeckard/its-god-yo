-- Widen the daily-send audience to include status='subscription_created' (not just 'active').
--
-- A confirmed trial subscriber only reaches status='active' when the invoice.paid webhook
-- (the $0 subscription_create invoice at trial start) lands and flips the row. That works at
-- the pinned Stripe version (invoice.paid does fire for the $0 trial-start invoice, verified),
-- but it makes trial-start delivery depend entirely on webhook delivery/timing (IGY has a
-- history of broken webhook delivery) and on a create-vs-webhook race. Including
-- 'subscription_created' means a confirmed subscriber with a stripe_subscription_id receives
-- verses immediately, independent of the webhook. Explicit allowlist so a future status can't
-- silently enter the audience; still excludes canceled/past_due/requires_action.
--
-- Applied to remote 2026-07-31 via MCP apply_migration (IGY's mechanism — its local migrations
-- are drifted from remote, so db push is unsafe). This file is committed at the same version the
-- remote recorded (20260731163734) to keep the repo in sync going forward and NOT repeat the
-- apply-migration-with-no-local-file drift we just reconciled on USN.
--
-- Purely widens the audience filter; activation logic (the invoice.paid webhook handler) is
-- unchanged. Verified: subscription_created + active appear in daily_send_audience;
-- canceled/past_due/requires_action are excluded.
create or replace view public.daily_send_audience as
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
    AND p.status IN ('subscription_created'::text, 'active'::text)
    AND p.stripe_subscription_id IS NOT NULL
  ORDER BY c.id, p.created_at DESC, p.id;

comment on view public.daily_send_audience is
  'Daily-send eligibility: consent confirmed + has stripe_subscription_id + status IN (subscription_created, active). subscription_created is included so a confirmed trial subscriber receives verses at trial start without waiting on the invoice.paid webhook to flip status to active (removes the webhook-timing dependency + the create/webhook race). Excludes canceled/past_due/requires_action.';
