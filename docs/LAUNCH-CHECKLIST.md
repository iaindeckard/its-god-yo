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

## Other launch items

_(append as identified)_
