# IGY Launch Checklist

Hard blockers must be **done** before IGY revenue goes live (`PURCHASES_ENABLED → true`).
A blocker is not a nice-to-have; shipping without it means a downstream system is silently
wrong, or a paying customer gets nothing. **Last refreshed: 2026-07-30.**

Current state: **`PURCHASES_ENABLED = false`** (deliberately re-gated) — see blockers below.

## 🔒 Sequencing constraint (load-bearing — do not violate)

Each stage must be **built AND verified working** before the next; never enable one in isolation:

1. **Content pipeline** (eligible-verse pool + human-approved batch) **and Stage 2 send mechanism** — built & verified, THEN
2. **Twilio / opt-in delivery** — wired & verified (the "reply YES" opt-in SMS actually delivers), THEN
3. **`PURCHASES_ENABLED → true`.**

Rationale: wiring Twilio/opt-in alone enables YES → subscription → a real charge 7 days later (post-trial). If the daily send doesn't exist yet, you'd be charging real customers for texts that never come. Order is load-bearing.

## 🚫 BLOCKERS (must be done before purchases reopen)

- [ ] **Verse eligibility pool + regenerated, human-approved `general` batch.**
  The `general` track draws a random verse from the *entire* KJV, which serves thin/unsuitable
  verses (itineraries, ceremonial lists, mid-narrative fragments, harsh judgment) — proven by
  the first batch's rejections. Build the Hybrid eligibility pool: AI-classify all ~31k KJV
  verses against the signed-off criteria (substance + self-contained + teen-appropriate tone) →
  human spot-review → curated eligible pool reusing the `verse_theme_tags` machinery. Point
  `general` generation at the pool, **regenerate the batch** (the current Sep 1–14 batch came
  from the OLD unfiltered pool and must be discarded), and human-approve it via `/admin/review/batch`.
  No thin/unsuitable verse may ever reach a subscriber. *(Full-KJV AI eligibility pass running 2026-07-30.)*

- [ ] **Teen send-time + timezone capture — LOCKED spec 2026-07-30 (build *after* Stage 2 design).**
  The teen sets their daily send time on a **new web "welcome" page** reached via a link in the
  post-YES confirmation SMS. The reply-YES stays as-is (TCPA consent + subscription trigger).
  - **Time:** 30-minute slots, **7:00 AM local floor** (no earlier — anti-accident/joke), default **12:00 PM** if unset.
  - **Timezone:** browser-auto-detected on the welcome page (editable). Fallback chain:
    teen `consent_log.timezone` → `purchaser_timezone` (**new**, browser-detected at parent web signup)
    → coarse country/area-code default → `America/Chicago`.
  - **Storage:** add `consent_log.send_time_local time` + `consent_log.timezone text` (per teen);
    add `pending_signups.purchaser_timezone text`. (Parent signup captures **no** TZ today; teen touchpoint
    is SMS-only — no web page, no time/TZ captured; only `recipient_country_code` derived from phone.)
  - Stage 2 resolves each subscriber's UTC send instant from `(send_time_local ?? noon)` in the resolved TZ.
  - Full spec: memory `project_igy_send_time_spec`. **Feeds Stage 2 — do not build until Stage 2 design is locked.**

- [ ] **Stage 2 — the daily send mechanism.** *(Largest net-new piece — does not exist.)*
  No Vercel cron, no pg_cron, no send code. Needs: an **active-subscriber delivery model**
  (track / language / timezone / phone / consent status; there is no `subscribers` table today),
  a **scheduled job** that selects each subscriber's approved slot for "today" and sends at their
  local window, **idempotency** (never double-send a day), `igy_sms_log` logging + cost, and
  missing-content handling (skip/fallback when a track has no approved day). Verify end-to-end
  against a **test number** before Twilio goes live.

- [ ] **Twilio outbound delivery — live.**
  Outbound is **not delivering**: `igy_sms_log` has **0 rows ever**, and toll-free verification is
  still pending. Until it delivers, the opt-in "reply YES" SMS never arrives → no subscription →
  no charge → no daily texts (it fails *closed*, which is why no money is at risk today). Resolve
  the toll-free (or 10DLC) verification, set prod `TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM_NUMBER`, and
  prove a real opt-in round-trip: YES → confirmed subscriber → first daily verse delivered.

## 🔐 Security hardening (before public traffic)

- [ ] **Harden the generate-* edge functions with `has_permission()`.**
  `generate-monthly-batch`, `generate-daily-verse` (and likely `propose-theme-verses`) are gated
  by `verify_jwt` only — which the **public anon key** satisfies — so anyone can trigger dual-AI
  generation = an **AI-spend / wallet-DoS** vector. Apply the same pattern as the review functions
  (item 2): `auth.getUser()` + `has_permission()`, actor derived from the verified JWT; forward a
  real staff JWT from the caller. Not revenue-blocking, but a live exposure the moment the site
  sees traffic.

## ✅ Resolved / verified — 2026-07-30 (unless noted)

_These were previously listed as blockers; confirmed done against current state._

- **Stripe live-mode config** — `sk_live_` in Vercel Prod; `pk_live_` bundle-verified as *served*;
  live webhook endpoint `we_1TvfM4GZ9WDMHywotCPbht9W` (livemode, `invoice.paid` / `charge.refunded`
  / `charge.dispute.created`); signature verified **both sides** (client POST 200 + Vercel runtime
  log 200 on the current prod deploy). → **Supersedes** the old "webhook delivery broken / 0 endpoints"
  and "wrong `sk_test` key (404)" blockers.
- **`subscription_payments` ledger + reconcile/backfill cron** — table live (schema carries
  `settled_amount/fee/net_cents` + original-currency), fed **real-time** by the webhook
  (`capturePaidInvoice` → `upsertSubscriptionPayment`); daily reconcile cron live
  (`/api/cron/reconcile-payments`). → **Supersedes** the old "no table" + "no backfill job" blockers.
- **Self-signup disabled** — Supabase Auth `disable_signup = true`; staff onboard via invite (2026-07-30).
- **Review edge-fn auth hardened** — the 5 `review-*` functions require a staff JWT + `has_permission()`,
  verified both directions (anon → 401, authorized → succeeds) (2026-07-30, item 2).
- **Full-batch content review UI** — `/admin/review/batch` shows every slot (incl. AI-`agreed`, which the
  exceptions queue hid), with the canonical **KJV source** rendered next to Output A/B (2026-07-30).
- **Spanish gated** — `SPANISH_ENABLED = false` hides Spanish at signup (language step + `?lang=es`) and on
  the landing (toggle, RV1909 badge, transparency copy) until a reviewed Spanish batch exists (2026-07-30).

## Tech debt / downstream (not blocking launch)

- [ ] **IGY migration history drift** — local `supabase/migrations/` vs remote `schema_migrations`
  are out of sync; **use MCP `apply_migration` for IGY DDL, NOT `supabase db push`** (db push is
  unsafe here). Still true; `get_kjv_text_for_refs` RPC was added via `apply_migration` 2026-07-30.
- [ ] **DEI holding-co rollup recompute** — recompute IGY MRR from `subscription_payments` once real
  revenue lands (the original reason the ledger was a blocker; `igy_mirror_monthly_financials` in
  `dei-financial` is built and waiting for `recomputed_mrr_cents`).
- [ ] **Rejection "Reason" → category dropdown** — make rejection data queryable over time (awaiting a
  real category list).
