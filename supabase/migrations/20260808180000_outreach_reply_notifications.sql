-- Outreach reply notifications: a new RBAC permission gating the "someone replied
-- to our outreach" action items that surface on the admin landing page. The action
-- items themselves reuse the existing igy_action_items queue (kind =
-- 'outreach_reply'); `kind` is free-text, so no table change is needed. This only
-- adds the permission + role grants, mirroring finance.action_items.view.
INSERT INTO public.permissions (key, label, category) VALUES
  ('outreach.replies.view', 'View & resolve outreach reply notifications', 'outreach')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (job_role, permission_key, enabled) VALUES
  ('super_admin', 'outreach.replies.view', true),
  ('content_reviewer', 'outreach.replies.view', false)
ON CONFLICT (job_role, permission_key) DO UPDATE SET enabled = EXCLUDED.enabled;
