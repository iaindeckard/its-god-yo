-- RBAC permission for the preorder launch trigger (admin-initiated batch that
-- flips preorder_pending -> awaiting_confirmation and sends the "reply YES"
-- invites). Follows the existing seed pattern: catalog row + an explicit
-- role_permissions row per role (super_admin enabled, content_reviewer disabled).

INSERT INTO public.permissions (key, label, category) VALUES
  ('billing.preorder.launch', 'Fire the preorder launch trigger', 'billing')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (job_role, permission_key, enabled) VALUES
  ('super_admin',      'billing.preorder.launch', true),
  ('content_reviewer', 'billing.preorder.launch', false)
ON CONFLICT (job_role, permission_key) DO UPDATE SET enabled = EXCLUDED.enabled;
