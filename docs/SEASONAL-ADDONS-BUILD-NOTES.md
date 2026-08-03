# Holy Season Add-Ons — Build Notes

Companion to the locked spec **IGY-Seasonal-Addons-Spec-v1.md** (Drive, locked
2026-08-02). This file records implementation-time corrections and decisions that
refine — but do not relitigate — the locked spec. Kept in-repo because the build
lives here and there's no clean Drive-doc update path; the Drive spec should get a
pointer to this file when convenient.

## Spec-count corrections (confirmed by Iain 2026-08-03)

The spec's headline day counts are illustrative; the date engine
(`lib/seasons/liturgical.ts`) computes the real windows. Confirmed treatments:

1. **Advent — variable 22–28 days, KEEP as-is.** The price is for the season, not
   per-day. "28" was illustrative (it's the max; e.g. 2028 is only 22). No behavior
   change. Advent sends on every day of its window (it does NOT skip Sundays — only
   Lent does).
2. **Lent — 40 *non-Sunday* days, correct on purpose.** Traditional Catholic/Anglican
   practice excludes the 6 Sundays (feast days, not fast days) from Lent's 40. Lent
   content sends only on the 40 non-Sunday days in the Ash Wednesday → Holy Saturday
   window (46 calendar days). Sundays in the window get nothing from this product.
3. **Epiphany — FIXED Jan 6, never transferred.** Episcopal/BCP rule (IGY's named
   affinity partner), not the US-RC Sunday-transfer. Locked in code + test.

## Free/paid overlap rule — never double-message a subscriber on one day

The 6 free climax-day sends go to the ENTIRE base (paid or not). The paid pipeline
MUST skip any day that the free pipeline already covers, so no subscriber gets two
different messages on the same calendar day from two pipelines.

| Season | Window (engine) | Free days inside window | Paid-EXCLUSIVE sends | "Days of value" |
|---|---|---|---|---|
| Christmastide | Dec 25 → Jan 5 (12) | Christmas Day (Dec 25) | **11** (Dec 26–Jan 5) | 12 (1 free + 11 paid) |
| Advent | 1st Sun Advent → Dec 24 (22–28) | none | **22–28** (all paid) | 22–28 |
| Lent | Ash Wed → Holy Sat (46 cal / 40 non-Sun) | **Good Friday** (non-Sunday!) + Palm Sunday (already Sunday-skipped) | **39** (40 non-Sun − Good Friday) | 40 non-Sun (1 free + 39 paid) |
| Eastertide | Easter Sun → day before Pentecost (49) | Easter Sunday | **48** (Easter free; Pentecost free & outside window) | 50 (2 free + 48 paid) |

### ⚠ New overlap found: Good Friday (Lent)
Beyond the three boundary days Iain named (Christmas / Easter / Pentecost), the
engine surfaced a fourth: **Good Friday** is a free climax day, is INSIDE the Lent
window, and is NOT a Sunday — so the Sunday-skip rule does not already exclude it.
Per the "never double-message" rule, the **Lent paid pipeline must also skip Good
Friday** (everyone gets the free Good Friday send). → Lent paid-exclusive = **39**,
not 40. (Palm Sunday is also a free day in the window but is a Sunday, so it's
already skipped.) This is the "any other boundary day you find" case Iain flagged.

## Twilio cost recheck (corrected paid-exclusive counts)

Twilio all-in ≈ **$0.012/message** (spec §8). Cost is the paid product's INCREMENTAL
sends only — free climax-day sends happen for the whole base regardless, so they are
not attributable to any paid product.

| Product | Paid sends | Twilio cost/teen/yr | Price | Margin | vs spec |
|---|---|---|---|---|---|
| Christmastide | 11 | ~$0.13 | $4.99 | ~$4.86 | spec 12/$0.14 |
| Advent | ≤28 (max) | ~$0.34 | $7.99 | ~$7.65 | unchanged |
| Lent + Holy Week | 39 | ~$0.47 | $12.99 | ~$12.52 | spec 40/$0.48 |
| Eastertide | 48 | ~$0.58 | $9.99 | ~$9.41 | spec 50/$0.60 (Iain est. 49) |

**Conclusion unchanged:** all four clear Twilio cost with wide margin. Corrected
counts are all *lower* than the spec's, so margins only improve. (Eastertide's true
paid count is 48, one below Iain's 49 estimate, because Easter Sunday is also free.)
Prices remain Twilio-safe but NOT content-labor-validated — do not change without asking.

## Phase E — quantity reconciliation must be SYMMETRIC (Iain, 2026-08-03)

`season_enrollments.quantity` is a teen-count snapshot at enroll; Phase E reconciles
it to the live teen count at charge time. It must mirror the existing family-teen
pattern in **both** directions, not just additions: adding a teen bills for them next
cycle, AND removing a teen mid-season stops billing for them next cycle (symmetric with
the DM-from-Him removal-credit/proration fix). Do not implement add-only.

## ⚠ Phase C real-selector finding (2026-08-03) — pool reuse ≠ seasonal tone

The real selector (`makePoolVerseSelector`) genuinely reuses `get_theme_track_pool`
(verified: all 4 seasons drew from it). BUT only `general` (2,080 verses) and
`comfort_hard_times` (3) tracks exist — there are **no season-toned tracks** — so every
season falls back to `general`. Result: selections are **tonally generic and
interchangeable** across Advent/Lent/Eastertide; none distinctly evokes anticipation /
repentance / celebration. Spec §9 ("AI selects a verse APPROPRIATE to that specific day")
is NOT met by pool-reuse alone. Concrete issues seen in the 4 real batches:
- Eastertide day 48 picked a lament ("hide not thyself from my supplication") — tonally
  opposite of Eastertide celebration.
- Christmastide had an identical-TEXT duplicate from two different refs (1 Chron 16:10 vs
  Ps 105:3) — **dedup is by verse_ref, not normalized text** (real defect: a subscriber
  could get the same message twice in a season).
- Selection "spread" clusters (consecutive verses, e.g. 1 Chron 16:10/11/12 as day 1 of
  three seasons).

The pipeline correctly lands everything `in_review`, so the human review queue is the
backstop — but with generic pre-selection the reviewer is doing 100% of the tonal
curation by hand (124 items/yr), which defeats AI pre-selection. **Options (Iain's call):**
(a) curate season-toned tracks (`season_advent`, …) in `verse_theme_tags` — the selector
already prefers them with `general` fallback; (b) add the AI appropriate-to-the-day
selection step §9 describes; (c) fix dedup to normalized text regardless. Do NOT treat the
current generic output as production-ready seasonal content.

## Recurring operational item (for Phase F integration-gate checklist)

**Annual liturgical-boundary spot-check (T-45 before Advent start).** Once a year,
before a new liturgical year's Phase B enrollment window opens, manually spot-check
that year's engine-computed season boundaries against episcopalchurch.org's published
calendar. NOT a live dependency or scraper — the engine stays the source of truth
(verified vs 17 real years + two-algorithm agreement 1583–2600 + invariants). This is
a cheap annual insurance policy against an edge case the original verification missed.
Nothing to build now; it belongs in the Phase F checklist as a recurring manual step.
