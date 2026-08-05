-- Remove em dashes from customer-facing / rendered seed + content rows the code
-- em-dash passes couldn't reach (they only cover source files). Applied via MCP
-- apply_migration (IGY workflow); repo-of-record copy.
--
-- Scope:
--  1. theme_tracks.description — the `general` row renders in the admin theme-tags
--     screen; the 4 season_* rows are internal but cleaned for consistency.
--  2. daily_slots — one approved English verse contains an em dash and IS texted
--     to subscribers (slipped past the AI-tells generation gate, which post-dates
--     it). Rewritten to two sentences.
--
-- NOT touched: verse_theme_tags.rationale (~48 rows) — internal AI review notes,
-- never customer-facing (same "leave internal strings" rule as server logs).

UPDATE theme_tracks SET description = 'No preference. The daily verse everyone gets, drawn from the full eligible pool.'
  WHERE key = 'general';
UPDATE theme_tracks SET description = 'Holy Season add-on pool for Lent (repentance/fasting). Not a user daily focus.'
  WHERE key = 'season_lent';
UPDATE theme_tracks SET description = 'Holy Season add-on pool for Eastertide (resurrection/celebration). Not a user daily focus.'
  WHERE key = 'season_eastertide';
UPDATE theme_tracks SET description = 'Holy Season add-on pool for Advent (anticipation/coming). Not a user daily focus.'
  WHERE key = 'season_advent';
UPDATE theme_tracks SET description = 'Holy Season add-on pool for Christmastide (incarnation/joy). Not a user daily focus.'
  WHERE key = 'season_christmastide';

-- Targeted phrase replace preserves the rest of the verse (incl. emoji) exactly.
UPDATE daily_slots
  SET final_translation = replace(final_translation, 'morning — clean slate', 'morning. Clean slate')
  WHERE id = '71ee0806-957b-47a7-ab0f-c5e7e57ffaab'
    AND final_translation LIKE '%morning — clean slate%';
