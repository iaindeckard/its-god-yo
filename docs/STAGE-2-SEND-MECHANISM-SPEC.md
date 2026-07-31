# Stage 2 — Daily Send Mechanism (design spec, NOT built)

Status: **spec only**, 2026-07-30. Scope: the general track, launch. Builds on the
locked send-time spec (`project_igy_send_time_spec`) and the curated-pool content
pipeline (`project_igy_general_pool`). No code in this doc is built yet.

This is the launch-blocking gap: verses are generated, reviewed, and approved into
`daily_slots`, but **nothing sends them**. Today the only outbound SMS is the opt-in,
sent by `submit-consent`. Stage 2 is the machine that turns an approved `daily_slots`
row into a text in a subscriber's phone at their chosen local time, exactly once a day.

---

## 1. What exists today (grounding)

| Piece | State |
|---|---|
| Verse content | `daily_slots(scheduled_date, theme_track, verse_ref, final_translation, status)` — `status='approved'` = send-ready. `final_translation_es` gated off. |
| Subscriber identity | **No `subscriptions` table.** A recipient = one `consent_log` row (`recipient_phone`, `recipient_first_name`, `language`, `consent_status`, `trial_ends_at`, `pending_signup_id`). "Active" = `consent_status='confirmed'` + its `pending_signups.status='active'`. |
| Opt-in / YES | `submit-consent` sends opt-in SMS; `processInboundReply` (`lib/twilioInbound.ts`) flips consent → `confirmed`, starts the 7-day trial, creates the Stripe subscription. **This is the TCPA consent gate — do not move it.** |
| Outbound primitive | `POST https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json`, Basic auth, body `From/To/Body`. Env: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`. |
| SMS cost ledger | `igy_sms_log` (per `pending_signup_id`: `message_sid`, `segments`, `cost_cents`, `sent_at`…). Financial rollup only; **not** a delivery/idempotency log. 0 rows ever. |
| Crons | Vercel crons in `vercel.json`, all Next routes under `/api/cron/*` (family-trials, donation-fund-close, reconcile-payments…). UTC. |
| Send time / timezone | **Not captured anywhere.** Locked spec adds them (see §7, §8). |

---

## 2. Audience — who gets a text today

A recipient is **due for today's send** iff ALL hold:

- `consent_log.consent_status = 'confirmed'` (replied YES, not opted out)
- its `pending_signups.status = 'active'` (not `cancelled`) and has a `stripe_subscription_id`
- not already sent for this recipient's local date (idempotency, §6)
- an **approved** `daily_slots` row exists for (recipient's local date, `general`, recipient's language) (§4)

Notes:
- **Trial and paid both send.** Trial is just `consent_status='confirmed'` before the
  first invoice; nothing special at send time.
- **Opt-out is immediate.** `consent_status='opted_out'` (STOP) drops them from the
  next tick — no end-of-period grace for opt-outs (legal requirement).
- **Cancellation** (`pending_signups.status='cancelled'`) drops them. If we later honor
  "paid through period end," that becomes a status the audience query includes — flagged
  as an open decision (§11-D).
- Family: each teen is an independent `consent_log` row, so they're audience members
  individually and automatically — no special-casing.

Audience is best expressed as a **DB view** `daily_send_audience` (resolves the joins +
the timezone fallback chain, §7) so the send job is a thin consumer.

---

## 3. Scheduling architecture (the crux)

Vercel crons fire in **UTC**; subscribers pick a **local** time at 30-min granularity.
Bridging them:

**A "send tick" cron every 30 minutes** — `0,30 * * * *` (48 ticks/day). Each tick:

1. `now = current UTC instant`.
2. For each audience row, resolve timezone (§7) and compute the recipient's **current
   local wall-clock time** and **local date**, DST-aware (`Intl.DateTimeFormat` with
   `timeZone`, full ICU on Vercel Node — or `date-fns-tz`/`Temporal`).
3. Recipient is **due now** if `localTime` (floored to the 30-min slot) `==`
   `send_time_local ?? 12:00` AND no send row exists for `(recipient, localDate)`.
4. Look up the approved `daily_slots` row for `(localDate, 'general', language)`; send
   its `final_translation` (§4, §5).
5. Record the send (§6) with `message_sid`.

Why a 30-min tick and not "compute next-due timestamps":
- Robust to server downtime (a missed tick self-heals next tick; anyone still "due"
  and unsent gets caught).
- No per-user timers/queues to maintain.
- 48 lightweight invocations/day is trivial at launch scale.

**Timezone offset caveat:** 30-min ticks align to whole- and half-hour UTC offsets,
which covers the entire US/CA/MX launch audience. Zones with :45 offsets (India +5:30
is fine; Nepal +5:45, Chatham +12:45) would need a finer tick — out of launch scope,
noted for international.

**"Today's verse" = recipient's LOCAL calendar date.** Two users in different zones
near midnight may map one tick to different local dates; each local date has its own
`daily_slots` row, so everyone gets that date's verse on their date. Correct by design.

---

## 4. Content selection & the no-missing-content guard

For a due recipient: fetch `daily_slots WHERE scheduled_date = localDate AND
theme_track='general' AND status='approved'` and language column:
- EN: `final_translation`
- ES: `final_translation_es` **and** `SPANISH_ENABLED` (gated off → no ES sends at
  launch; an ES row that slips through is **skipped + alerted**, never EN-fallback
  without consent to switch language).

**If no approved row exists for that local date → DO NOT send.** No random/fallback
verse (same principle as the pool fix — unreviewed content must never reach a teen).
Instead log `skipped_no_content` and **alert** (this is the operational tripwire for the
"needs_review pile becomes a real problem" runway). A silent no-send is almost as bad as
a bad send — the subscriber paid for a daily text.

This makes the review runway a hard operational dependency: **every launch date in the
send window must have an approved general slot before that date arrives.**

---

## 5. Send execution

- Reuse the `submit-consent` Twilio REST pattern. Add a `StatusCallback` URL so Twilio
  posts delivery receipts (§9).
- Throttle: Twilio toll-free default ~3 msg/s. Chunk each tick's due-batch with a small
  concurrency cap + backoff. Trivial at launch; matters at scale.
- Body: `final_translation` (already teen-slang, already reviewed). Consider a tiny
  standard suffix only if legally needed; TCPA/HELP-STOP footer requirements are already
  satisfied at opt-in — confirm no per-message footer is required for the recurring
  program (open item, §11-E).

---

## 6. Idempotency & the delivery log (new)

New table **`daily_send_log`** (operational; distinct from the financial `igy_sms_log`):

```
daily_send_log(
  id uuid pk default gen_random_uuid(),
  consent_id uuid not null references consent_log(id),
  send_local_date date not null,
  daily_slot_id uuid references daily_slots(id),
  language text not null,
  message_sid text,                 -- Twilio SID once accepted
  status text not null,             -- claimed | sent | delivered | failed | undelivered | skipped_no_content
  error text,
  segments int,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  UNIQUE(consent_id, send_local_date)   -- exactly-once per recipient per local day
)
```

**Claim-first pattern for exactly-once under overlapping ticks:**
1. `INSERT ... ON CONFLICT (consent_id, send_local_date) DO NOTHING` with `status='claimed'`.
2. If the insert affected 0 rows → someone already claimed this recipient/day → skip.
3. If it claimed → send via Twilio → `UPDATE` to `sent` + `message_sid` (or `failed` + `error`).

This survives a tick overrunning into the next tick, and a redeploy mid-tick.

`igy_sms_log` stays the **financial** record (cost/segments for the donation-fund + P&L
rollup), written/updated from the delivery-status webhook (§9) keyed by `message_sid`.
`daily_send_log.message_sid` is the join between the two.

---

## 7. Timezone & send-time resolution (locked spec)

Per-recipient send instant = `(send_time_local ?? 12:00)` interpreted in the resolved
timezone, DST-aware. Fallback chain for the timezone (first non-null wins):

1. `consent_log.timezone` (teen's, set on the welcome page, §8)
2. `pending_signups.purchaser_timezone` (parent's, browser-detected at web signup — **new**)
3. coarse `consent_log.recipient_country_code` / phone area-code default
4. `America/Chicago` (final default)

`send_time_local` null ⇒ noon. **7:00 AM local floor** enforced at write time (the
welcome page can't set earlier). This resolution lives in the `daily_send_audience` view
so the send job never re-implements it.

---

## 8. Capture: the teen welcome page (Option A, locked)

Keep reply-YES as consent + subscription trigger. Add to the post-YES *"You're all
set!"* SMS a link → new teen page `itsgodyo.com/welcome?c=<welcome_token>`:

- **`consent_log.welcome_token uuid default gen_random_uuid()`** — opaque, non-enumerable
  handle for the page (never expose the row uuid).
- Page auto-detects tz via `Intl.DateTimeFormat().resolvedOptions().timeZone` (editable,
  pre-filled); 30-min time picker, 7am floor, default noon.
- A token-scoped public endpoint (`POST /api/welcome`) writes `send_time_local` +
  `timezone` to that one consent row. No auth beyond the unguessable token; rate-limit
  + validate (floor, granularity, IANA tz whitelist).
- If the teen never opens it → defaults apply (noon + fallback tz). Nothing blocks on it.
- Parent web signup must **also** start capturing `purchaser_timezone` (browser tz at
  submit) → the fallback source.

---

## 9. Delivery status & finally populating cost

Twilio `StatusCallback` → new `POST /api/twilio/status` (verify Twilio signature, reuse
`verifyTwilioSignature`):
- Map `queued→sent→delivered` / `failed`/`undelivered` onto `daily_send_log.status`.
- On a billable status, write the real cost to `igy_sms_log` (segments, `cost_cents`)
  keyed by `message_sid` + `pending_signup_id`. **This is what finally makes
  `igy_sms_log` non-empty** and feeds the donation-fund/P&L rollups accurately.
- Alert on `failed`/`undelivered` above a threshold (carrier block, bad number).

---

## 10. Data-model additions (all via MCP `apply_migration`, never db push — IGY rule)

1. `consent_log.send_time_local time` (null ⇒ noon)
2. `consent_log.timezone text` (IANA; null ⇒ fallback chain)
3. `consent_log.welcome_token uuid default gen_random_uuid()` (+ unique index)
4. `pending_signups.purchaser_timezone text`
5. new `daily_send_log` (§6)
6. new view `daily_send_audience` (§2 + §7 resolution)
7. (optional) `theme_tracks`-style default tz per country for fallback step 3

Plus new code: `/api/cron/daily-send` (the tick), `/api/welcome` (capture),
`/api/twilio/status` (receipts), the `/welcome` page, and a `daily-send`-cron entry in
`vercel.json` (`0,30 * * * *`).

---

## 11. Decisions

**LOCKED 2026-07-30 (Iain):**
- **A. Cron home → Vercel cron / Next `/api/cron/daily-send`.** Matches every existing
  cron, shares `getSupabaseAdmin` + the Twilio pattern. `vercel.json` entry `0,30 * * * *`.
- **B. Trial day-0 → first verse on the NEXT local day at their send time.** No same-day
  one-off; avoids collision with the welcome flow.
- **C. Missing approved content → `skipped_no_content` + alert, NEVER fallback-send.**
  Makes the review runway a hard dependency: every send-window date must have an approved
  general slot before that date arrives.
- **D. Cancellation → stop immediately on `pending_signups.status='cancelled'`.** Opt-out
  (STOP) also stops immediately, always.

**Still open (minor / non-blocking):**
- **E. Per-message footer:** confirm no recurring-message HELP/STOP footer is legally
  required (opt-in already carries it) before omitting it from the daily body. Legal check.
- **F. Send-time editability:** welcome page set-once vs re-editable later. Default
  re-editable; revisit at build.

---

## 12. Build order & gating

Hard sequencing (`project_igy_purchases_enablement_gate`): **content pipeline + this send
mechanism built & verified → Twilio toll-free verification clears (30527 / EIN
propagation) → THEN `PURCHASES_ENABLED=true`.** Never enable one in isolation.

Suggested build sequence:
1. Migrations (§10 items 1–6).
2. Welcome page + `/api/welcome` capture + parent-signup `purchaser_timezone`.
3. `daily_send_audience` view.
4. `/api/cron/daily-send` tick (claim-first, no-fallback guard) + `vercel.json` entry.
5. `/api/twilio/status` receipts → `igy_sms_log`.
6. End-to-end test in **test mode** to a real test handset across ≥2 timezones and a
   DST boundary; confirm exactly-once, correct local-time delivery, opt-out mid-stream,
   and missing-content skip+alert.
7. Only after Twilio verification clears: flip `PURCHASES_ENABLED`.
```
