-- Bounty v2 pass 2 — Phase A: capture which text a report is about, hold the AI
-- assessment, and support the "already-resolved" dedupe state.
--
-- text_lang closes a spec-§7 gap pass 1 missed: reports must say whether they're
-- about the English teen reword (daily_slots.final_translation) or the Spanish
-- RV1909 translation (final_translation_es). Publishing a correction needs it to
-- know which field to edit. group_key (app-computed) now also includes text_lang
-- so an EN error and an ES error on the same verse are DISTINCT groups.
--
-- ai_* columns hold the on-demand AI assessment + proposed fix (Phase B). Never
-- auto-published — a human approves every publish.

ALTER TABLE public.igy_error_reports
  ADD COLUMN IF NOT EXISTS text_lang       text,
  ADD COLUMN IF NOT EXISTS ai_is_error     boolean,
  ADD COLUMN IF NOT EXISTS ai_assessment   text,
  ADD COLUMN IF NOT EXISTS ai_proposed_fix text,
  ADD COLUMN IF NOT EXISTS ai_target_slot_id uuid REFERENCES public.daily_slots(id),
  ADD COLUMN IF NOT EXISTS ai_assessed_at  timestamptz;

ALTER TABLE public.igy_error_reports
  DROP CONSTRAINT IF EXISTS igy_error_reports_text_lang_check;
ALTER TABLE public.igy_error_reports
  ADD CONSTRAINT igy_error_reports_text_lang_check
  CHECK (text_lang IS NULL OR text_lang IN ('en','es'));

-- Add 'duplicate_resolved' (report of an already-fixed verse: auto-thank, no reward).
ALTER TABLE public.igy_error_reports DROP CONSTRAINT IF EXISTS igy_error_reports_status_check;
ALTER TABLE public.igy_error_reports
  ADD CONSTRAINT igy_error_reports_status_check
  CHECK (status IN ('pending','confirmed','rejected','duplicate_resolved'));

COMMENT ON COLUMN public.igy_error_reports.text_lang IS
  'Which text the report is about: en = English teen reword (daily_slots.final_translation); es = Spanish RV1909 translation (final_translation_es). Determines the correction target field.';
