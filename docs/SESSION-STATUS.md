# Session Status — IGY (It's God, Yo!)

_Last updated: 2026-07-26_

This file captures cross-product (DEI) session state and IGY-specific state so nothing
is lost between sessions. A matching copy lives in the USN-web repo.

---

## ⚠️ Founder compensation logic changed materially — 2026-07-26

The founder-compensation logic was rebuilt today. **The v4 comp agreement it was
previously based on was never executed** and has been replaced by six documents:

1. Operating Agreement **v5**
2. Written Consent of the Sole Member **v6**
3. Founder & CEO Compensation Agreement **v10**
4. Founder Incentive Plan **v5**
5. Acknowledgment of Non-Member Status — **Ashley Clark**
6. **Member Advance Note** template

**Financial rules now live in `DEI-Dashboard-Financial-Engine-SPEC-2026-07-26.md`
rev. 3**, which **supersedes the founder-comp sections of the July 23 dashboard
spec**. Do **not** build from the old (July 23) spec.

---

## This repo (IGY) — state as of 2026-07-26

- **`supabase/migrations/20260726000001_subscriber_cohort_and_anchor.sql` — pushed.**
  Cohort-safe subscriber history, normalized MRR (not cash), and the singleton
  project revenue anchor. Three tables: `subscribers` (durable per-customer;
  `country` nullable, `first_paid_month` generated stored), `subscriber_monthly_revenue`
  (one live row per customer-month, `mrr_cents` + `cash_collected_cents`,
  supersede-not-mutate corrections), `project_revenue_anchor` (singleton, 30-day
  provisional against refund).
  - Write-side wiring is **not yet built** (see open decisions).
- Prior session work already on `main`: referral system (merged), Twilio TFV,
  Stripe price/key reconciliation, verify-prices.

---

## Open decisions (do not lose)

1. **Deploy the USN legal-page changes, or hold** until the USN documentation
   sweep is done. (Docs must ship with or before the legal deploy — see #5.)
2. **Exclude gift plans from NRR cohorts.** Gift subscriptions don't renew by
   design and will drag blended NRR below the **95% milestone threshold**.
   Segment/handle `gift_annual` separately.
3. **Push USN cohort tables now, or wait for Fan Pass.** The USN cohort/anchor
   migration is written but held (nothing writes to it until Fan Pass billing
   exists).
4. **Write-side wiring not yet scoped** (app code, not migrations):
   - `setup-intent` → `subscribers.country` (from `payment_method.card.country`)
   - paid-invoice → monthly MRR snapshot + `project_revenue_anchor`
5. **USN documentation sweep not yet briefed** — in-app user guide, sponsor and
   athlete docs, admin handbook, `equity_approved_causes`, FAQ, email copy.
   **Must ship with or before the legal-page deploy, not after.**

---

## Cross-repo pointer

USN-web state (legal edits, sponsor/cohort migrations, doc sweep) is tracked in
`USN-web/docs/SESSION-STATUS.md` — same open-decisions list.
