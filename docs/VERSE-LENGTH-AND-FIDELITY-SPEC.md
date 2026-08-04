# Verse Length Floor + Solid Fidelity Check — SPEC

Status: **FINAL / buildable** (2026-08-04). Decisions locked (see "Locked decisions").
One consequence of the locked decisions needs a product call before build — see
**§1.4 (emoji vs length)**.

## Problem
Rendered verses are currently one short sentence (e.g. *"God listens to the struggles
and doesn't forget those locked up."*). We want a **floor of 2 sentences** — but lengthening
a slang paraphrase raises the risk of drifting from Scripture (adding claims, changing
theology/tone). So the length change is coupled to a **stronger fidelity check**.

## Key insight
Today's "context check" does **not** check the rendering against the source verse. It only
measures whether the two models (Claude = output A, GPT-4o = output B) agree *with each
other*, and only **lexically** (`similarity()` = Jaccard word overlap, threshold `0.35`).
Two models can agree on an embellishment that isn't in the verse; that proxy weakens as text
gets longer, so lengthening **requires** a real source-fidelity gate.

## Locked decisions (2026-08-04)
1. **Length:** floor **2** sentences, target **2–3**, hard max **5**. Sentence count is a
   **secondary guide**. The **hard enforced gate is the SMS budget** (§1.3), measured on the
   **DM-from-Him-wrapped** message. Flag for review if *either* bound is exceeded.
2. **SMS ceiling:** **2 segments max**, confirmed.
3. **Fidelity judge:** **hard-block** — any fidelity flag (added claim, omitted core meaning,
   tone/theology drift) forces `needs_review`. No auto-approval exceptions.

## Current pipeline (grounding — `supabase/functions/generate-daily-verse` + `generate-monthly-batch`)
1. Pick an eligible source verse from the track pool (`get_theme_track_pool`).
2. `buildPromptEn` / `buildPromptEs` → prompt. The prompt says *"Keep it short, like a real
   text message"* — this is the source of the shortness.
3. Two independent model calls (Claude `claude-sonnet-4-6`, OpenAI `gpt-4o`), `max_tokens: 200`.
4. `similarity(A,B)` ≥ `AGREEMENT_THRESHOLD (0.35)` → `agreement_status = 'agreed' | 'disagreed'`.
5. `needs_review_reasons`: `ai_disagreement` (low overlap) or `incomplete_sentence`.
   - NOTE: `incomplete_sentence` currently checks the **source** verse's punctuation, not the
     output — latent bug. Fold into the output validator (§1.2).
6. `slot_status = 'needs_review'` if any reason, else `'agreed'`. Approval (`review-approve`)
   sets `final_translation` from the chosen output.

## Part 1 — Length
### 1.1 Prompt change
Replace *"Keep it short, like a real text message"* with: *"Write 2–3 short sentences —
enough to unpack the verse's meaning naturally, still texting a friend. Don't pad, and don't
add ideas that aren't in the verse. Keep it plain-text (no emoji) so it stays a short SMS."*
(The "no emoji" clause is contingent on §1.4.)

### 1.2 Deterministic sentence check (secondary guide, on the rendering)
Sentence count `< 2` → reason `too_short`; `> 5` → `too_long`. Replaces the misdirected
`incomplete_sentence` check.

### 1.3 SMS-segment gate — THE hard limit (encoding-aware, on the DM-wrapped message)
- Compute segments on the **actual bytes that will be sent**: encoding-aware.
  - **GSM-7** (plain ASCII + the GSM basic set): 160 chars single, **153/segment** concatenated.
  - **UCS-2** (triggered by ANY emoji, em-dash `—`, curly quotes `'` `"`, `…`, etc.): 70 chars
    single, **67/segment** concatenated.
- Measure on the **DM-wrapped** body via `composeDailyMessage(text, {dm:true, firstName, lang})`,
  because the same verse is sent wrapped to DM-on subscribers and verbatim to DM-off — the wrap
  is the worst case. `firstName` is unknown at generation → reserve a **15-char name allowance**.
- **Reject (`needs_review`, reason `exceeds_sms_budget`) if the wrapped worst case > 2 segments.**
- Build a shared `smsSegments(text)` util (used by generation + a lint/test) so the calc is
  identical everywhere.

### 1.4 Consequence of the locked decisions — emoji vs. reachable length (needs a product call)
With the current style, 2–3 sentences will **not fit** 2 segments:
- The DM wrap itself contains `💛` → every DM-on message is **UCS-2** regardless of the verse.
- UCS-2 → 2 segments = **~134 chars**. The wrap (`"{Name}, a little note from Me today 💛\n\n…
  \n\nI've got you."`) consumes ~50 → **~84 chars left for the verse ≈ 1–2 short sentences.**
- Per Locked Decision 1 the segment budget wins, so emoji-heavy verses come out **shorter than
  the 2–3 target** — the target becomes unreachable, not just secondary.

To make 2–3 sentences actually reachable in 2 segments, go **GSM-7**: drop emoji and swap
`—`→`-`, `'`→`'`, `"`→`"` in **both** the verse renderings **and** the DM wrap (`💛` out). Then
2 segments = **~306 chars**; wrap ~48 → ~258 for the verse → 2–3 short sentences fit.

**Decision needed (D4):** keep emoji (accept ~1–2 sentence verses, target rarely met) **or** go
plain-text GSM-7 (2–3 sentences reachable, lose the emoji texture). Recommend **GSM-7** if the
2–3-sentence length is a real goal; otherwise relabel the target as "1–2 sentences." Implementation
follows this either way — only the prompt's emoji clause and the DM-wrap glyph change.

## Part 2 — Fidelity check (hard-block, per Locked Decision 3)
Add a **faithfulness judge (output-vs-source)**:
1. Third AI pass (strong model, temperature 0). Input `{source_text, candidate_rendering}`.
   Output JSON: `faithful: bool`, `added_claims: string[]`, `omitted_core: string[]`,
   `tone_or_theology_drift: bool`. Run on **both** A and B.
2. **Fail-closed:** a slot auto-marks `agreed` (no human) only when ALL hold — sentence bounds OK
   AND wrapped ≤ 2 segments AND both A & B pass the judge (empty `added_claims`/`omitted_core`,
   no drift) AND A ≈ B. **Any** fidelity flag → `needs_review`, no exceptions.
3. Optionally upgrade `similarity(A,B)` to semantic (embedding cosine); the judge is the real
   safeguard, A/B agreement is just a cheap pre-filter.
4. **Reviewer support:** show the judge's `added_claims`/`omitted_core` next to the KJV/RV source
   in `/admin/review`, plus the new reasons, so a human spots drift in seconds.

## Part 3 — Edge cases
- **Very short source verses** ("Jesus wept"; "They are new every morning: great is thy
  faithfulness."): 2–3 faithful sentences require **restating the same idea, not adding new
  content**. The judge prompt must explicitly *allow faithful expansion/paraphrase and reject
  new ideas* — otherwise these always flag.
- **Bilingual:** identical bounds + budget + judge on the ES (RV1909 → Mexican slang) path.
  (Spanish accented chars are also non-GSM-7 → UCS-2; the segment calc already handles this,
  but note ES verses inherently get the ~134-char budget.)
- **Retro:** the Sept `general` batch was generated under the old short prompt — decide
  regenerate vs. leave.
- **No schema migration:** `needs_review_reasons` is `text[]`; new reason strings slot in.

## Reason strings (final set)
`ai_disagreement`, `too_short`, `too_long`, `exceeds_sms_budget`, `fidelity_risk` (+ the
offending `added_claims`/`omitted_core` surfaced to the reviewer).

## Rollout
Behind the generation functions only. Generate a test batch, review the flag rate, tune
thresholds, and do **not** feed it to live sends until reviewed. Additive to — not a substitute
for — actually populating each track's content (see the launch content plan).
