# Verse Length Floor + Solid Fidelity Check — SPEC

Status: **DRAFT** (2026-08-04). Not built. Three decisions to lock before implementation (see end).

## Problem
Rendered verses are currently one short sentence (e.g. *"God listens to the struggles
and doesn't forget those locked up."*). We want a **minimum of 2–3 sentences** — but
lengthening a slang paraphrase raises the risk of drifting from Scripture (adding claims,
changing theology/tone). So the length change is coupled to a **stronger fidelity check**.

## Key insight
Today's "context check" does **not** check the rendering against the source verse. It only
measures whether the two models (Claude = output A, GPT-4o = output B) agree *with each
other*, and only **lexically** (`similarity()` = Jaccard word overlap, threshold `0.35`).
Two models can agree on an embellishment that isn't in the verse. That proxy gets weaker as
text gets longer, so lengthening **requires** adding a real source-fidelity gate.

## Current pipeline (grounding — `supabase/functions/generate-daily-verse` + `generate-monthly-batch`)
1. Pick an eligible source verse from the track pool (`get_theme_track_pool`).
2. `buildPromptEn` / `buildPromptEs` → prompt. **The prompt says "Keep it short, like a real
   text message"** — this is the source of the shortness.
3. Two independent model calls (Claude `claude-sonnet-4-6`, OpenAI `gpt-4o`), `max_tokens: 200`.
4. `similarity(A,B)` ≥ `AGREEMENT_THRESHOLD (0.35)` → `agreement_status = 'agreed' | 'disagreed'`.
5. `needs_review_reasons`: `ai_disagreement` (low overlap) or `incomplete_sentence`.
   - NOTE: `incomplete_sentence` currently checks the **source** verse's punctuation, not the
     output. Looks like a latent bug — fold into the output-length validator (Part 1.2).
6. `slot_status = 'needs_review'` if any reason, else `'agreed'`. Approval (`review-approve`)
   sets `final_translation` from the chosen output and `status='approved'`.

## Part 1 — Length floor
1. **Prompt change:** replace *"Keep it short, like a real text message"* with a 2–3 sentence
   target, e.g. *"Write 2–3 short sentences — enough to unpack the verse's meaning naturally,
   still texting a friend. Don't pad, and don't add ideas that aren't in the verse."*
2. **Deterministic output validator** (on the rendering, not the source): sentence count `< 2`
   → reason `too_short`; over max (`> 4` sentences or over the SMS budget) → `too_long`.
   Replaces the misdirected `incomplete_sentence` check.
3. **SMS-cost guard:** more sentences → more characters → more Twilio segments → more cost per
   send (`lib/costs.ts` prices per segment). Enforce a hard character ceiling (proposed: ≤ 2
   segments ≈ ~306 GSM-7 chars) and flag `exceeds_sms_budget`. This is a recurring cost lever
   at scale — cap it deliberately.

## Part 2 — Solid fidelity check (the important half)
Add a **faithfulness judge (output-vs-source)** — the missing piece:
1. Third AI pass (strong model, temperature 0). Input `{source_text, candidate_rendering}`.
   Output structured JSON: `faithful: bool`, `added_claims: string[]` (asserted but not in the
   verse), `omitted_core: string[]`, `tone_or_theology_drift: bool`. Run on **both** A and B.
2. **Fail-closed composition** — a slot auto-marks `agreed` (no human needed) only when ALL
   hold: length in range AND both A & B pass the judge (empty `added_claims`, no drift) AND
   A ≈ B. Any miss → `needs_review` with the specific reason. This is what makes the check
   *stricter as we lengthen*.
3. Optionally upgrade `similarity(A,B)` from lexical Jaccard to semantic (embedding cosine);
   lexical overlap means less on longer, more varied text. The judge is the real safeguard —
   A/B agreement becomes just a cheap pre-filter.
4. **Reviewer support:** show the judge's `added_claims` next to the KJV/RV source in
   `/admin/review`, plus the new reasons, so a human spots drift in seconds.

## Part 3 — Edge cases / decisions to lock
- **Very short source verses** ("Jesus wept"; "They are new every morning: great is thy
  faithfulness."): 2–3 faithful sentences require **restating the same idea, not adding new
  content**. The judge prompt must explicitly *allow faithful expansion/paraphrase and reject
  new ideas*, or these verses always flag.
- **Bilingual:** identical floor + judge on the ES (RV1909 → Mexican slang) path.
- **DM-from-Him wrap:** `composeDailyMessage` adds first-person framing words — measure length
  on the **base verse**, not post-wrap.
- **Retro:** the existing Sept `general` batch was generated under the old short prompt —
  decide regenerate vs. leave.
- **No schema migration:** `needs_review_reasons` is `text[]`; new reason strings slot in.

## Rollout
Behind the generation functions only. Generate a test batch, review the flag rate, tune
thresholds, and do **not** feed it to live sends until reviewed. Additive to — not a substitute
for — actually populating each track's content.

## Decisions needed to finalize
1. Hard sentence bounds — floor 2, target 2–3, hard max (4?).
2. SMS cost ceiling — acceptable segments per daily text (2? 3?).
3. Confirm the fidelity judge should **hard-block auto-approval** on any fidelity flag (recommended yes).
