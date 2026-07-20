-- needs_review_reasons: tells reviewers WHY a slot is queued, not just THAT it is.
-- Values: 'ai_disagreement' (similarity below threshold), 'incomplete_sentence'
-- (source verse fails the terminal-punctuation completeness heuristic). A slot
-- can carry both. Applied to project bkwtlfkhfbfyzgnozixw 2026-07-20.
ALTER TABLE public.daily_slots
  ADD COLUMN IF NOT EXISTS needs_review_reasons text[],
  ADD COLUMN IF NOT EXISTS needs_review_reasons_es text[];
