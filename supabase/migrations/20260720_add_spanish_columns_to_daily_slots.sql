-- Adds Spanish (RV1909-sourced) output columns to daily_slots so both languages
-- share one row per scheduled_date. Applied to project bkwtlfkhfbfyzgnozixw 2026-07-20.
ALTER TABLE public.daily_slots
  ADD COLUMN IF NOT EXISTS ai_output_a_es text,
  ADD COLUMN IF NOT EXISTS ai_output_b_es text,
  ADD COLUMN IF NOT EXISTS agreement_status_es text,
  ADD COLUMN IF NOT EXISTS final_translation_es text,
  ADD COLUMN IF NOT EXISTS status_es text;

ALTER TABLE public.daily_slots
  ADD CONSTRAINT daily_slots_agreement_status_es_check
  CHECK (agreement_status_es IS NULL OR agreement_status_es = ANY (ARRAY['agreed','disagreed']));

ALTER TABLE public.daily_slots
  ADD CONSTRAINT daily_slots_status_es_check
  CHECK (status_es IS NULL OR status_es = ANY (ARRAY['verse_selected','generating','agreed','needs_review','approved','sent']));
