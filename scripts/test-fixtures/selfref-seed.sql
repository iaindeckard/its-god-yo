-- ⚠️ STALE TEST FIXTURE — DO NOT RUN AS-IS.
-- The Stripe test-clock, customer, and subscription IDs below are from a
-- completed Phase-7 test run and are NO LONGER VALID. Regenerate them (new
-- clock + customer + trialing subscription via scripts/referral-testclock.mjs)
-- and substitute the new IDs before reuse. What is kept here is the JOIN
-- STRUCTURE and insert order (consent_log → referral_codes → pending_signups →
-- referral_events) and the self-referral void wiring — that is the reusable part.
-- =============================================================================
-- =============================================================================
-- IGY referral system — Phase-7 SELF-REFERRAL void seed
-- Stripe test clock: clock_1TxWz6GYyfOIjQvMnFfNr5Ur  (sandbox TEST key, acct_1TvPGD…)
-- Self customer (referrer AND referee): cus_UxRsIadMqZXvcV
-- Seeded self sub (SECOND run):          sub_1TxY9jGYyfOIjQvM0Ej9g80g  (7-day trial)
-- WRITE-ONLY FILE. Do not run yet — this is for review before apply.
-- =============================================================================
--
-- WHAT THIS TESTS
-- ─────────────────────────────────────────────────────────────────────────────
-- The self-referral guard in lib/referral.ts:255
--     if (ev.referrer_customer_id === args.refereeCustomerId) -> void
-- When the seeded sub's trial ends and its first REAL charge posts
-- (invoice.paid, amount_paid > 0, billing_reason 'subscription_cycle';
-- route.ts:109), the webhook resolves the pending_signups row by
-- stripe_subscription_id (route.ts:79), then onRefereePaidConversion looks up
-- the referral_event by referee_pending_signup_id and derives refereeCustomerId
-- from the INVOICE's customer (route.ts:82,86) = cus_UxRsIadMqZXvcV. Because
-- referral_events.referrer_customer_id is ALSO cus_UxRsIadMqZXvcV, the guard
-- fires: referral_events.status flips 'pending' -> 'void', no credit is applied
-- to either side. The pending->void flip is the "it fired correctly" signal.
--
-- WHY referrer_customer_id == referee here (intentional, not a bug)
-- ─────────────────────────────────────────────────────────────────────────────
-- Unlike the happy-path seed (step2-seed.sql, where referrer MUST != referee),
-- this row deliberately sets them EQUAL — that equality IS the condition under
-- test. referee_customer_id is left NULL: the guard voids BEFORE the conversion
-- writes it, so it must stay NULL after the run (if it ever gets populated, the
-- void path did NOT execute).
--
-- CONSENT STATE: same rationale as step2-seed.sql — consent_log seeded
-- 'confirmed' (production-consistent terminal state). The referral path never
-- reads consent_log; it's set 'confirmed' only so the DB state is one prod could
-- actually hold. The consent gate is not exercised here.
--
-- Row count: FOUR inserts. pending_signups.teen_consent_id and
-- referral_events.referral_code_id are NOT NULL FKs, so consent_log and
-- referral_codes must exist first. Insert order below satisfies the FKs, wrapped
-- in one transaction (all-or-nothing).
-- =============================================================================

BEGIN;

-- (1) consent_log — FK anchor for pending_signups.teen_consent_id (NOT NULL).
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
  confirmation_reply_received,
  confirmation_reply_at
) VALUES (
  'eeeeeeee-0000-4000-8000-000000000001',
  '+15555550199',
  'en',
  'PHASE7 SELFREF attestation',
  'test',
  'PHASE7 SELFREF disclosure',
  'test',
  'primary_subscriber',
  'confirmed',
  true,
  now()
);

-- (2) referral_codes — the SELF customer's active code. FK target for
--     referral_events.referral_code_id. owner = the self customer.
INSERT INTO public.referral_codes (
  id,
  owner_customer_id,    -- ← SELF (cus_UxRsIadMqZXvcV) = referrer
  owner_kind,
  code,
  active
) VALUES (
  'ffffffff-0000-4000-8000-000000000001',
  'cus_UxRsIadMqZXvcV',
  'family',
  'IGY-SELFREF7',
  true
);

-- (3) pending_signups — the "referee" deferred signup, which is the SAME customer.
--     CRITICAL: stripe_subscription_id = the SECOND self sub — the webhook's
--     ONLY match key. Must be sub_1TxY9j… (NOT the first, unseeded sub_1TxY8v…).
INSERT INTO public.pending_signups (
  id,
  language,
  plan_key,                 -- must NOT start with 'group'
  base_price_id,            -- NOT NULL; not read by the referral path
  teen_consent_id,          -- ← FK to consent_log row (1)
  stripe_customer_id,       -- ← SELF (cus_UxRsIadMqZXvcV); realism only, not the match key
  stripe_subscription_id,   -- ← SECOND SELF SUB — THE webhook match key
  status
) VALUES (
  '11111111-0000-4000-8000-000000000001',
  'en',
  'family_annual',
  'price_1TvePpGYyfOIjQvMDbu9cFli',
  'eeeeeeee-0000-4000-8000-000000000001',
  'cus_UxRsIadMqZXvcV',
  'sub_1TxY9jGYyfOIjQvM0Ej9g80g',
  'subscription_created'
);

-- (4) referral_events — the PENDING attribution. referrer == the self customer.
--     referee_customer_id LEFT NULL: the guard voids before conversion would
--     write it, so it MUST remain NULL. status 'pending' → guard flips 'void'.
INSERT INTO public.referral_events (
  id,
  referral_code_id,             -- ← FK to referral_codes row (2)
  referrer_customer_id,         -- ← SELF (cus_UxRsIadMqZXvcV); == the invoice customer → guard voids
  referee_pending_signup_id,    -- ← FK to pending_signups row (3); the conversion lookup key
  status                        -- 'pending' → webhook self-ref guard moves it → 'void'
) VALUES (
  '22222222-0000-4000-8000-000000000001',
  'ffffffff-0000-4000-8000-000000000001',
  'cus_UxRsIadMqZXvcV',
  '11111111-0000-4000-8000-000000000001',
  'pending'
);

COMMIT;

-- =============================================================================
-- PER-TABLE EXISTENCE CHECK — run AFTER applying. Expected: all four true.
-- =============================================================================
SELECT '1_consent_log'     AS seed_row,
       EXISTS (SELECT 1 FROM public.consent_log
               WHERE id = 'eeeeeeee-0000-4000-8000-000000000001') AS row_exists
UNION ALL
SELECT '2_referral_codes',
       EXISTS (SELECT 1 FROM public.referral_codes
               WHERE id = 'ffffffff-0000-4000-8000-000000000001')
UNION ALL
SELECT '3_pending_signups',
       EXISTS (SELECT 1 FROM public.pending_signups
               WHERE id = '11111111-0000-4000-8000-000000000001')
UNION ALL
SELECT '4_referral_events',
       EXISTS (SELECT 1 FROM public.referral_events
               WHERE id = '22222222-0000-4000-8000-000000000001')
ORDER BY seed_row;

-- =============================================================================
-- POST-ADVANCE VOID CHECK — run AFTER advancing the clock past the trial.
-- Expected: status = 'void'  AND  referee_customer_id IS NULL.
-- =============================================================================
-- SELECT status, referee_customer_id
-- FROM public.referral_events
-- WHERE id = '22222222-0000-4000-8000-000000000001';

-- =============================================================================
-- TEARDOWN TRACKING — every identifier this run touches
-- ─────────────────────────────────────────────────────────────────────────────
-- DB rows seeded by THIS file (delete in reverse-FK order):
--   referral_events    22222222-0000-4000-8000-000000000001
--   pending_signups    11111111-0000-4000-8000-000000000001
--   referral_codes     ffffffff-0000-4000-8000-000000000001
--   consent_log        eeeeeeee-0000-4000-8000-000000000001
--
-- Stripe subs on clock clock_1TxWz6GYyfOIjQvMnFfNr5Ur to account for at teardown:
--   sub_1TxY9jGYyfOIjQvM0Ej9g80g   ← SEEDED (second run) — the sub under test
--   sub_1TxY8vGYyfOIjQvMrIe0DtnR   ← UNSEEDED first run — teardown ONLY, do NOT seed
-- (cleanup <clockId> cascades and deletes all subs/customers on the clock, so
--  deleting the clock covers both; the DB rows above must be deleted separately.)
-- =============================================================================
