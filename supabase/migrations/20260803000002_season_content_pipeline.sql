-- Holy Season add-ons — Phase C: seasonal content pipeline + review queue.
-- Separate from the daily-verse needs_review queue. Applied via MCP apply_migration.

-- Extend the Phase B readiness table with review-window + roll-up state.
ALTER TABLE public.season_content_batches
  ADD COLUMN IF NOT EXISTS season_start    date,
  ADD COLUMN IF NOT EXISTS review_opens_at date,        -- T-30
  ADD COLUMN IF NOT EXISTS t14_alerted_at  timestamptz, -- T-14 alarm fired (once)
  ADD COLUMN IF NOT EXISTS total_items     int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS approved_items  int NOT NULL DEFAULT 0;

-- One reviewable content item per send-date in a batch. Mirrors the daily pipeline's
-- verse_ref / english / slang shape, but in its OWN queue (NOT daily_slots.needs_review).
CREATE TABLE IF NOT EXISTS public.season_content_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id        uuid NOT NULL REFERENCES public.season_content_batches(id) ON DELETE CASCADE,
  send_date       date NOT NULL,
  day_index       int  NOT NULL,
  verse_ref       text,
  verse_text      text,
  translated_text text,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reject_reason   text,
  reviewed_by     text,
  reviewed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, send_date)
);
COMMENT ON TABLE public.season_content_items IS
  'Per-send-date reviewable item for a season content batch. Separate review queue from the daily-verse needs_review pipeline. Batch flips to approved only when every item is approved.';

CREATE INDEX IF NOT EXISTS idx_season_content_items_batch  ON public.season_content_items (batch_id);
CREATE INDEX IF NOT EXISTS idx_season_content_items_status ON public.season_content_items (batch_id, status);
