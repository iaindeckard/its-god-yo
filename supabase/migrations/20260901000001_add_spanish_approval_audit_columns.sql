-- Adds per-language approval audit columns so approving the Spanish dimension
-- of a daily_slot (review-approve-es / review-reject-translation-es) records
-- who/when, matching the existing English approved_by/approved_at columns.
-- Applied to project bkwtlfkhfbfyzgnozixw 2026-09-01.
ALTER TABLE public.daily_slots
  ADD COLUMN IF NOT EXISTS approved_by_es uuid,
  ADD COLUMN IF NOT EXISTS approved_at_es timestamptz;
