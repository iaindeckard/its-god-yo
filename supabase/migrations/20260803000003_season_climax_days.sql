-- Phase D: free climax-day sends to the entire active base. Applied via MCP apply_migration.
CREATE TABLE IF NOT EXISTS public.climax_content (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  climax_key      text NOT NULL CHECK (climax_key IN ('christmas_day','epiphany','palm_sunday','good_friday','easter_sunday','pentecost')),
  liturgical_year int NOT NULL,
  verse_ref       text,
  verse_text      text,
  translated_text text,
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_review','approved')),
  approved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (climax_key, liturgical_year)
);
COMMENT ON TABLE public.climax_content IS
  'Per climax-day (6 fixed liturgical days) content, one per (climax_key, year). Sent free to the ENTIRE active base. Gated on status=approved, same as season batches.';

-- Mark the shared send log so climax rows are distinguishable from daily-verse rows.
-- The existing UNIQUE(consent_id, send_local_date) is the cross-pipeline one-message-
-- per-day guarantee: daily / climax / (future) season all claim the same key.
ALTER TABLE public.daily_send_log
  ADD COLUMN IF NOT EXISTS send_kind  text NOT NULL DEFAULT 'daily' CHECK (send_kind IN ('daily','climax','season')),
  ADD COLUMN IF NOT EXISTS climax_key text;
