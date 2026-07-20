import "server-only";
import { getSupabaseAdmin } from "./supabaseAdmin";

/**
 * Permission resolution against the REAL RBAC tables (permissions /
 * role_permissions / user_permission_overrides) — the same schema that mirrors
 * the USN pattern. Effective permissions = the base role's enabled rows, with
 * any per-user overrides layered on top (granted=true adds, granted=false
 * removes).
 *
 * DEFERRED LOGIN: there is no staff auth/login yet (auth.users is empty, and the
 * review Edge Functions likewise trust the caller). Until a real login exists,
 * the acting staff identity comes from env (ADMIN_DEV_ROLE / ADMIN_DEV_USER_ID).
 * The GATING itself is real — it reads role_permissions from the database — only
 * the identity SOURCE is a stand-in. When login lands, swap getCurrentStaff() to
 * resolve the identity from the session JWT; nothing else changes.
 */
export interface Staff {
  jobRole: string;
  userId: string | null;
}

export function getCurrentStaff(): Staff {
  return {
    jobRole: process.env.ADMIN_DEV_ROLE || "super_admin",
    userId: process.env.ADMIN_DEV_USER_ID || null,
  };
}

export async function getEffectivePermissions(staff: Staff): Promise<Set<string>> {
  const admin = getSupabaseAdmin();
  const { data: rolePerms, error } = await admin
    .from("role_permissions")
    .select("permission_key, enabled")
    .eq("job_role", staff.jobRole);
  if (error) throw new Error(`rbac_role_query_failed: ${error.message}`);

  const set = new Set<string>();
  for (const r of rolePerms ?? []) if (r.enabled) set.add(r.permission_key);

  if (staff.userId) {
    const { data: overrides } = await admin
      .from("user_permission_overrides")
      .select("permission_key, granted")
      .eq("user_id", staff.userId);
    for (const o of overrides ?? []) {
      if (o.granted) set.add(o.permission_key);
      else set.delete(o.permission_key);
    }
  }
  return set;
}

export async function currentPermissions(): Promise<Set<string>> {
  return getEffectivePermissions(getCurrentStaff());
}

export async function can(permissionKey: string): Promise<boolean> {
  return (await currentPermissions()).has(permissionKey);
}

/** Thrown by requirePermission; API routes translate it to a 403. */
export class ForbiddenError extends Error {
  constructor(public permissionKey: string) {
    super(`forbidden: missing permission '${permissionKey}'`);
    this.name = "ForbiddenError";
  }
}

export async function requirePermission(permissionKey: string): Promise<Staff> {
  const staff = getCurrentStaff();
  const perms = await getEffectivePermissions(staff);
  if (!perms.has(permissionKey)) throw new ForbiddenError(permissionKey);
  return staff;
}
