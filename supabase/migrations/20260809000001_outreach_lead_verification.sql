-- Verification pass for outreach leads. A lead must pass BOTH a source-page
-- content check AND an email-domain (MX) check before it can enter a LIVE send.
-- Orthogonal to `status` (funnel state) — a lead can be active-but-unverified.
-- Verification goes stale after 90 days; the send gate re-checks verified_at.
--
-- Automated verification only ever emits 'passed' or 'needs_manual' (either check
-- failing -> needs_manual, never auto-rejected). 'failed' is reserved in the CHECK
-- for future/manual use. Only 'passed' and 'manual_override' are send-eligible.

ALTER TABLE public.igy_outreach_leads
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified','passed','failed','needs_manual','manual_override')),
  ADD COLUMN IF NOT EXISTS verified_at        timestamptz,
  ADD COLUMN IF NOT EXISTS verification_notes jsonb;

-- The send gate filters on verification_status; keep it fast.
CREATE INDEX IF NOT EXISTS idx_outreach_leads_verification
  ON public.igy_outreach_leads (verification_status);

-- New RBAC permission: clear a failed / needs_manual lead by hand (manual override).
-- Permission-gated, NOT identity-gated — assignable to other roles later via
-- /admin/roles. Default: super_admin only.
INSERT INTO public.permissions (key, label, category) VALUES
  ('marketing.outreach.verify_override', 'Manually override outreach lead verification', 'marketing')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (job_role, permission_key, enabled) VALUES
  ('super_admin',      'marketing.outreach.verify_override', true),
  ('content_reviewer', 'marketing.outreach.verify_override', false)
ON CONFLICT (job_role, permission_key) DO UPDATE SET enabled = EXCLUDED.enabled;
