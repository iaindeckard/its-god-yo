import "server-only";
import { createClient } from "./supabase/server";
import { getSupabaseAdmin } from "./supabaseAdmin";
import { reportAdminAccessFailure } from "./securityAlert";

/**
 * Real staff RBAC. Identity comes from the Supabase Auth session (@supabase/ssr);
 * authorization is the has_permission() SQL function (staff_members.job_role →
 * user_permission_overrides → role_permissions). There is NO env stub and NO
 * default role: a request with no session is Unauthorized; an authenticated user
 * with no staff_members row is Forbidden on every permission.
 */
export interface Staff {
  userId: string;
  jobRole: string;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("unauthorized: no staff session");
    this.name = "UnauthorizedError";
  }
}

/** Thrown by requirePermission; API routes translate it to a 403. */
export class ForbiddenError extends Error {
  constructor(public permissionKey: string) {
    super(`forbidden: missing permission '${permissionKey}'`);
    this.name = "ForbiddenError";
  }
}

/** The authenticated staff member (session → staff_members), or null if there is
 *  no session or the user is not an active staff member. */
export async function getCurrentStaff(): Promise<Staff | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await getSupabaseAdmin()
    .from("staff_members")
    .select("job_role, is_active")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!data || data.is_active === false) return null;
  return { userId: user.id, jobRole: data.job_role as string };
}

/** All effective permission keys for a resolved staff member — role defaults plus
 *  per-user overrides. Used to conditionally render admin nav. */
export async function getEffectivePermissions(staff: Staff): Promise<Set<string>> {
  const admin = getSupabaseAdmin();
  const { data: rolePerms, error } = await admin
    .from("role_permissions")
    .select("permission_key, enabled")
    .eq("job_role", staff.jobRole);
  if (error) throw new Error(`rbac_role_query_failed: ${error.message}`);
  const set = new Set<string>();
  for (const r of rolePerms ?? []) if (r.enabled) set.add(r.permission_key);

  const { data: overrides } = await admin
    .from("user_permission_overrides")
    .select("permission_key, granted")
    .eq("user_id", staff.userId);
  for (const o of overrides ?? []) {
    if (o.granted) set.add(o.permission_key);
    else set.delete(o.permission_key);
  }
  return set;
}

/** Whether the current session's staff member has a permission (has_permission RPC —
 *  the single source of authz truth). False if no session or not a staff member. */
export async function can(permissionKey: string): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase.rpc("has_permission", { p_user_id: user.id, p_permission_key: permissionKey });
  return data === true;
}

/**
 * Require a permission or throw. UnauthorizedError (→401) when there is no session;
 * ForbiddenError (→403) when authenticated but not permitted — including an
 * authenticated user with no staff_members row (has_permission returns false).
 */
export async function requirePermission(permissionKey: string): Promise<Staff> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new UnauthorizedError();
  const { data: allowed } = await supabase.rpc("has_permission", { p_user_id: user.id, p_permission_key: permissionKey });
  if (allowed !== true) {
    // Tier 3 security signal: record this authenticated-but-denied attempt and let
    // the reporter decide whether repeated failures warrant an emergency SMS.
    // Best-effort and self-contained — never blocks the 403.
    await reportAdminAccessFailure({ principal: user.id, permissionKey }).catch(() => {});
    throw new ForbiddenError(permissionKey);
  }
  const { data: sm } = await getSupabaseAdmin()
    .from("staff_members").select("job_role").eq("user_id", user.id).maybeSingle();
  return { userId: user.id, jobRole: (sm?.job_role as string) ?? "" };
}
