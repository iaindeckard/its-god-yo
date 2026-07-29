-- Bounty v2 pass 2 — Phase C: publish corrections to live daily_slots, bound
-- into corrections_log / review_sessions.
--
-- corrections_log.action_type currently allows only the pre-publish review
-- actions ('reject_verse','reject_translation'). Add the post-publish bounty
-- correction + its revert. category is free text (no CHECK) — we use 'error_bounty'.
--
-- Publishing edits LIVE scripture content, so it's gated behind a new permission,
-- content.queue.publish, granted to super_admin only (content_reviewer can
-- assess/reject via finance.bounty.review but NOT publish).

ALTER TABLE public.corrections_log DROP CONSTRAINT IF EXISTS corrections_log_action_type_check;
ALTER TABLE public.corrections_log
  ADD CONSTRAINT corrections_log_action_type_check
  CHECK (action_type IN ('reject_verse','reject_translation','bounty_correction','bounty_revert'));

INSERT INTO public.permissions (key, label, category) VALUES
  ('content.queue.publish', 'Publish/revert an error-bounty correction to live daily content', 'content')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (job_role, permission_key, enabled) VALUES
  ('super_admin',      'content.queue.publish', true),
  ('content_reviewer', 'content.queue.publish', false)
ON CONFLICT (job_role, permission_key) DO UPDATE SET enabled = EXCLUDED.enabled;
