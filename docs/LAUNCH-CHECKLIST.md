# IGY Launch Checklist

Hard blockers must be **done** before IGY revenue goes live. A blocker is not a
nice-to-have; shipping without it means a downstream system is silently wrong.

## 🚫 BLOCKERS

- [ ] **Row-level `subscription_payments` table fed by the IGY Stripe webhook — must land
  BEFORE IGY takes its first dollar, not merely "before launch".**
  Every realized recurring charge must land as a row in IGY's own DB (mirroring USN's
  `sponsor_payments`), carrying at minimum: stripe subscription id, stripe invoice/payment
  id, gross/fee/net cents, status, period, created_at.

  **Why this is a blocker, not a nice-to-have:** the DEI holding-company rollup recomputes
  IGY's MRR *independently* to USN's canonical definition (recurring subscription-backed net
  revenue × 12) and compares it against IGY's own reported `mrr_cents` — a divergence check
  that catches "IGY's dashboard and DEI's dashboard disagree and nobody noticed." That check
  can only compute the independent number from a row-level payments source. **No table →
  `recomputed_mrr_cents` stays NULL forever → the divergence check never turns on** and IGY's
  self-reported revenue is trusted with nothing cross-checking it. This is the classic launch
  deferral that never gets done; it is listed here specifically so it does not slip.

  **Why "first dollar", not "launch":** the DEI rollup handles unverified revenue by
  exclude-and-flag — unverified IGY revenue is shown as a separate flagged amount, NOT folded
  into the consolidated total. That is the correct behavior, but it has a failure mode: from
  the moment IGY takes real money until this table exists, that revenue is real, unverified,
  and sitting *outside* the DEI headline — so the holding-company dashboard confidently
  *understates* the business. The only way that window never opens is for this table to be
  live before the first charge is ever taken. If it lands in time, the entire unverified-IGY
  branch stays theoretical and the headline is trustworthy from dollar one.

  DEI side is already built and waiting: `igy_mirror_monthly_financials` in `dei-financial`
  has `source_mrr_cents`, `recomputed_mrr_cents`, and a three-state `mrr_verification_status`
  (`unverified` until this lands). See dei-financial migration
  `20260725123000_igy_divergence_three_state_null_aware.sql`.

- [ ] **Production Stripe webhook delivery is BROKEN — no endpoint is actually
  receiving events.** Distinct from and more urgent than the `subscription_payments`
  work above: that table can only be fed if the webhook receives events at all, and
  right now it does not.
  - **Supposedly fixed 2026-07-24:** the webhook was recreated (endpoint `we_1Twkc…`,
    signing secret placed in Vercel) after a wrong-secret 400 outage.
  - **Actually missing (verified 2026-07-28):** the Stripe account has **0 registered
    webhook endpoints**. The `we_1Twkc…` endpoint is gone, so prod's
    `STRIPE_WEBHOOK_SECRET` points at a non-existent endpoint and **no Stripe event is
    delivered to `itsgodyo.com/api/stripe/webhook`**. The route itself is deployed and
    healthy (correctly rejects bad signatures) — it simply never receives anything.
  - **CONFIRMED BROKEN — prod `STRIPE_SECRET_KEY` is wrong (2026-07-28 test).** With a
    valid signed test event delivered to the endpoint, the handler's
    `stripe.charges.retrieve()` returned **404 "No such charge"** for a charge that
    definitely exists in `acct_1TvPFiGZ9WDMHywo` test mode. A 404 (not 401) means the
    key authenticates but points at a **different account or live mode** — i.e. the
    still-open 2026-07-24 "update `STRIPE_SECRET_KEY` to the rotated `sk_test`" item is
    unresolved. Effect: every webhook capture that needs a Stripe API call (charge /
    balance_transaction retrieval) fails and is swallowed by `safeCapture` → **no rows
    are ever written**, silently. This must be fixed (set prod `STRIPE_SECRET_KEY` to
    the correct current key for `acct_1TvPFiGZ9WDMHywo`) before the ledger works at all,
    and it is separate from the endpoint/secret fix above.
  - **Real fix required before ANY real purchase:** register a **live-mode** endpoint →
    `itsgodyo.com/api/stripe/webhook` subscribed to at least `invoice.paid`,
    `charge.refunded`, `charge.dispute.created`; set its signing secret as the
    production `STRIPE_WEBHOOK_SECRET`; and confirm `STRIPE_SECRET_KEY` is current for
    the right account. **Any test-mode endpoint registration verifies the code path
    only — it is NOT this fix.**

## Near-term follow-ups (not a blocker, but do NOT let this slide)

- [ ] **Backfill / reconciliation job for `subscription_payments`.** The webhook
  capture is intentionally **best-effort**: a ledger-insert failure is logged and
  swallowed (`safeCapture` in `app/api/stripe/webhook/route.ts`) so it can never
  break the subscription status update or referral/outreach clawback that share the
  same Stripe event cases. That decouples ledger durability from the live webhook —
  which means a dropped or failed capture has **no automatic retry**. This job IS
  the safety net for that design: periodically replay Stripe balance transactions
  (charges + refunds + disputes) into `subscription_payments`, idempotent on
  `balance_transaction_id`, and alert on any gap vs Stripe. Until it exists, a
  swallowed capture failure is a silently missing row and the DEI rollup would
  under-read that revenue. Build alongside / just after the table lands — this is
  the corresponding safety net, not optional polish.

## Tech debt / cleanup (not blocking)

- [ ] **Reconcile IGY's migration history: local files vs remote `schema_migrations`.**
  As of 2026-07-28 the two are badly out of sync — **18 local migration files
  (sequential stamps like `20260722000001`) vs 36 applied migrations on remote
  (timestamp stamps like `20260722124348`), with only 2 versions in common.** The
  remote has clearly been maintained via `apply_migration` / dashboard, not
  `supabase db push` against these files, so **`db push` is currently unsafe on IGY**
  (it would refuse on history mismatch, or try to replay ~15 already-applied
  migrations). `subscription_payments` (`20260728000001`) was applied via
  `apply_migration` for exactly this reason. Cleanup options: `supabase migration
  repair` to reconcile, or re-baseline the local migrations dir to match remote.
  Not urgent, but until it's fixed the local `supabase/migrations/` dir is NOT a
  reliable source of truth for what's deployed, and `db push` must not be run.

## Other launch items

_(append as identified)_
