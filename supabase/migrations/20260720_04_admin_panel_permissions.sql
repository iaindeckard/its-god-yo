-- Stage 0 of the admin panel: new permissions for promo-code management and the
-- KPI dashboard. This EXTENDS the existing RBAC schema (permissions /
-- role_permissions / staff_job_roles / ...) that mirrors the USN pattern -- it
-- does not redesign it. Two new categories are introduced: 'billing' and
-- 'analytics' (alongside the existing 'admin' and 'content').
--
-- The existing seed pattern gives EVERY (role, permission) pair an explicit
-- role_permissions row -- including explicit `false` rows -- rather than relying
-- on absence to mean "denied". We follow that pattern here.

-- 1) permission catalog rows
INSERT INTO public.permissions (key, label, category) VALUES
  ('billing.promo_codes.view',       'View promo codes',               'billing'),
  ('billing.promo_codes.create',     'Create a promo code',            'billing'),
  ('billing.promo_codes.edit',       'Edit an existing promo code',    'billing'),
  ('billing.promo_codes.deactivate', 'Deactivate/delete a promo code', 'billing'),
  ('analytics.dashboard.view',       'View KPI dashboard',             'analytics')
ON CONFLICT (key) DO NOTHING;

-- 2) super_admin -> all five ENABLED
INSERT INTO public.role_permissions (job_role, permission_key, enabled) VALUES
  ('super_admin', 'billing.promo_codes.view',       true),
  ('super_admin', 'billing.promo_codes.create',     true),
  ('super_admin', 'billing.promo_codes.edit',       true),
  ('super_admin', 'billing.promo_codes.deactivate', true),
  ('super_admin', 'analytics.dashboard.view',       true)
ON CONFLICT (job_role, permission_key) DO UPDATE SET enabled = EXCLUDED.enabled;

-- 3) content_reviewer -> all five explicitly DISABLED. A content reviewer has no
--    reason to touch billing or see business KPIs; keeping the role tightly
--    scoped is deliberate and consistent with its content-queue scoping.
INSERT INTO public.role_permissions (job_role, permission_key, enabled) VALUES
  ('content_reviewer', 'billing.promo_codes.view',       false),
  ('content_reviewer', 'billing.promo_codes.create',     false),
  ('content_reviewer', 'billing.promo_codes.edit',       false),
  ('content_reviewer', 'billing.promo_codes.deactivate', false),
  ('content_reviewer', 'analytics.dashboard.view',       false)
ON CONFLICT (job_role, permission_key) DO UPDATE SET enabled = EXCLUDED.enabled;
