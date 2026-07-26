-- ⚠️ STALE TEST FIXTURE — DO NOT RUN AS-IS.
-- The Stripe test-clock, customer, and subscription IDs below are from a
-- completed Phase-7 test run and are NO LONGER VALID. Regenerate them (new
-- clock + customer + trialing subscription via scripts/referral-testclock.mjs)
-- and substitute the new IDs before reuse. What is kept here is the JOIN
-- STRUCTURE and insert order (consent_log → referral_codes → pending_signups →
-- referral_events) — that is the reusable part.
-- =============================================================================
-- =============================================================================
-- IGY referral system — Phase-7 happy-path seed (STEP 2)
-- Stripe test clock: clock_1TxWz6GYyfOIjQvMnFfNr5Ur  (sandbox TEST key, acct_1TvPGD…)
-- Referrer: cus_UxRsIadMqZXvcV   Referrer sub: sub_1TxWz8GYyfOIjQvMQwqgXb2S
-- Referee:  cus_UxRsSoKShvlgxc   Referee  sub: sub_1TxWzCGYyfOIjQvMZwtZ9zXf  (7-day trial)
-- WRITE-ONLY FILE. Do not run yet — this is for review before apply.
-- =============================================================================
--
-- ─────────────────────────────────────────────────────────────────────────────
-- (1) CONSENT STATE OF THE consent_log ROW — read this before applying.
-- ─────────────────────────────────────────────────────────────────────────────
-- The consent_log row below is seeded consent_status = 'confirmed'
-- (confirmation_reply_received = true). I set it to CONFIRMED deliberately:
-- IGY policy is locked — no billing until every recipient replies YES — so the
-- ONLY consent state that can coexist with a live, billing subscription in
-- production is 'confirmed'. A 'pending_confirmation' row paired with a
-- subscription that is about to take a real cycle charge is a state that
-- CANNOT occur in production, so seeding it that way would be a pass on an
-- impossible path. This row therefore represents the post-gate terminal state.
--
-- BUT be clear about what this test does and does NOT exercise:
--
--   * The referral conversion code (lib/referral.ts onRefereePaidConversion,
--     reached via app/api/stripe/webhook/route.ts handleReferralConversion)
--     NEVER READS consent_log. It keys solely on
--     pending_signups.stripe_subscription_id. So the consent gate is NOT under
--     test here and 'confirmed' vs 'pending' changes nothing in the referral
--     path — I set 'confirmed' only so the seeded DB state is one that could
--     actually exist in prod, not to claim the gate was exercised.
--
--   * This test BYPASSES the real consent gate mechanism. In production the
--     Stripe subscription is created only AFTER the SMS YES reply flips consent
--     to 'confirmed' (the deferred-billing handoff). Here the subscription was
--     created directly by scripts/referral-testclock.mjs, and this seed
--     fabricates a matching pending_signups row after the fact. No SMS, no real
--     reply. The consent gate itself is validated separately, not by this run.
--
--   In short: consent_log row = CONFIRMED (production-consistent terminal
--   state), gate mechanism = NOT exercised (bypassed by the test harness),
--   referral path = does not depend on consent at all.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Row count: this is FOUR inserts, not two. pending_signups.teen_consent_id and
-- referral_events.referral_code_id are both NOT NULL FKs, so consent_log and
-- referral_codes must exist first. Insert order below satisfies the FKs.
-- Wrapped in a single transaction: all-or-nothing. If any INSERT fails, Postgres
-- names the offending statement/constraint in the error and the whole thing
-- rolls back (nothing orphaned). After applying, run the existence check at the
-- bottom of this file to confirm all four rows landed and pinpoint any gap.
-- =============================================================================

BEGIN;

-- (1) consent_log — FK anchor for pending_signups.teen_consent_id (NOT NULL).
--     Seeded CONFIRMED (see header). Required NOT-NULL/no-default columns:
--     recipient_phone, language, attestation_text(+_version),
--     disclosure_text(+_version). consent_type left at 'primary_subscriber';
--     value is irrelevant to the referral path.
INSERT INTO public.consent_log (
  id,
  recipient_phone,
  language,
  attestation_text,
  attestation_text_version,
  disclosure_text,
  disclosure_text_version,
  consent_type,
  consent_status,               -- CONFIRMED — production-consistent terminal state
  confirmation_reply_received,  -- true — the "YES" reply
  confirmation_reply_at
) VALUES (
  'aaaaaaaa-0000-4000-8000-000000000001',
  '+15555550100',
  'en',
  'PHASE7 TEST attestation',
  'test',
  'PHASE7 TEST disclosure',
  'test',
  'primary_subscriber',
  'confirmed',
  true,
  now()
);

-- (2) referral_codes — the REFERRER's active code. FK target for
--     referral_events.referral_code_id (NOT NULL). owner MUST be the referrer.
INSERT INTO public.referral_codes (
  id,
  owner_customer_id,    -- ← REFERRER (cus_UxRsIadMqZXvcV)
  owner_kind,
  code,
  active
) VALUES (
  'bbbbbbbb-0000-4000-8000-000000000001',
  'cus_UxRsIadMqZXvcV',
  'family',
  'IGY-PHASE7TEST',
  true
);

-- (3) pending_signups — the REFEREE's deferred signup.
--     CRITICAL: stripe_subscription_id = refereeSub — the webhook's ONLY match key.
INSERT INTO public.pending_signups (
  id,
  language,
  plan_key,                 -- must NOT start with 'group' (else propagated code minted 'church' — cosmetic)
  base_price_id,            -- NOT NULL; not read by the referral path
  teen_consent_id,          -- ← FK to consent_log row (1)
  stripe_customer_id,       -- ← REFEREE (cus_UxRsSoKShvlgxc); not used for matching, set for realism
  stripe_subscription_id,   -- ← REFEREE SUB — THE webhook match key
  status
) VALUES (
  'cccccccc-0000-4000-8000-000000000001',
  'en',
  'family_annual',
  'price_1TvePpGYyfOIjQvMDbu9cFli',
  'aaaaaaaa-0000-4000-8000-000000000001',
  'cus_UxRsSoKShvlgxc',
  'sub_1TxWzCGYyfOIjQvMZwtZ9zXf',
  'subscription_created'
);

-- (4) referral_events — the PENDING attribution row (the thing under test).
--     referee_customer_id LEFT NULL on purpose: the webhook writes it at
--     conversion, so a NULL→cus_UxRsSoKShvlgxc flip is the "it fired" signal.
INSERT INTO public.referral_events (
  id,
  referral_code_id,             -- ← FK to referral_codes row (2)
  referrer_customer_id,         -- ← REFERRER (cus_UxRsIadMqZXvcV); must == code owner & must != referee
  referee_pending_signup_id,    -- ← FK to pending_signups row (3); the conversion lookup key
  status                        -- 'pending' → webhook moves it 'converted' → 'rewarded'
) VALUES (
  'dddddddd-0000-4000-8000-000000000001',
  'bbbbbbbb-0000-4000-8000-000000000001',
  'cus_UxRsIadMqZXvcV',
  'cccccccc-0000-4000-8000-000000000001',
  'pending'
);

COMMIT;

-- =============================================================================
-- (2) COMPANION PER-TABLE EXISTENCE CHECK
-- Run this AFTER applying the seed. Unlike the STEP-3 inner join (which returns
-- zero rows if ANY single row is missing, hiding which one), this returns one
-- row PER TABLE with a boolean, so a gap is pinpointed to the exact table.
-- Expected: all four row_exists = true.
-- =============================================================================
SELECT '1_consent_log'     AS seed_row,
       EXISTS (SELECT 1 FROM public.consent_log
               WHERE id = 'aaaaaaaa-0000-4000-8000-000000000001') AS row_exists
UNION ALL
SELECT '2_referral_codes',
       EXISTS (SELECT 1 FROM public.referral_codes
               WHERE id = 'bbbbbbbb-0000-4000-8000-000000000001')
UNION ALL
SELECT '3_pending_signups',
       EXISTS (SELECT 1 FROM public.pending_signups
               WHERE id = 'cccccccc-0000-4000-8000-000000000001')
UNION ALL
SELECT '4_referral_events',
       EXISTS (SELECT 1 FROM public.referral_events
               WHERE id = 'dddddddd-0000-4000-8000-000000000001')
ORDER BY seed_row;
