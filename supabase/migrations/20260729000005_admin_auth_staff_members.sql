-- Admin auth — Phase 1. Ports USN-web's authorization core to IGY.
--
-- IGY already has the RBAC catalog (permissions, role_permissions,
-- user_permission_overrides, staff_job_roles, audit_role_changes) but had NO
-- user→job_role mapping and no has_permission() function. This adds both:
--
--   staff_members : maps an authenticated auth.users.id → a job_role (+ is_active).
--   has_permission: the single authorization function requirePermission()/can() call.
--
-- IGY-lean vs USN: no coarse user_role enum bypass — the super_admin job_role
-- already grants all permissions via role_permissions. There is NO default role:
-- an authenticated user with no staff_members row resolves to false everywhere.

CREATE TABLE IF NOT EXISTS public.staff_members (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  job_role   text NOT NULL REFERENCES public.staff_job_roles(key),
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Service-role only (RLS enabled, no policies). has_permission() reads it as
-- SECURITY DEFINER, so RLS never blocks the authz check.
ALTER TABLE public.staff_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_permission(p_user_id uuid, p_permission_key text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_job_role     text;
  v_is_active    boolean;
  v_override     boolean;
  v_role_default boolean;
begin
  select job_role, is_active into v_job_role, v_is_active
    from public.staff_members where user_id = p_user_id;

  -- not a staff member (or deactivated) => Forbidden, never a default role
  if v_job_role is null or coalesce(v_is_active, false) = false then
    return false;
  end if;

  -- a per-user override wins over the role default
  select granted into v_override
    from public.user_permission_overrides
    where user_id = p_user_id and permission_key = p_permission_key;
  if v_override is not null then
    return v_override;
  end if;

  -- role default from the RBAC matrix
  select enabled into v_role_default
    from public.role_permissions
    where job_role = v_job_role and permission_key = p_permission_key;

  return coalesce(v_role_default, false);
end;
$$;

GRANT EXECUTE ON FUNCTION public.has_permission(uuid, text) TO authenticated, anon;
