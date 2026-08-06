import "server-only";
import { getSupabaseAdmin } from "./supabaseAdmin";

/**
 * Role / permission / staff administration (the data layer behind /admin/roles).
 * IGY's RBAC data model (staff_job_roles / permissions / role_permissions /
 * staff_members / user_permission_overrides) already exists and is populated; this
 * is purely the read/write layer the admin UI drives. All access is service-role
 * (getSupabaseAdmin); every caller is gated on admin.roles.manage at the route.
 *
 * has_permission() is fully data-driven (no hardcoded super_admin bypass), so
 * super_admin's access lives entirely in its role_permissions rows. We therefore
 * REFUSE to change super_admin's permission set here (a mistaken toggle would lock
 * everyone out); the UI also renders that grid read-only.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://bkwtlfkhfbfyzgnozixw.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export interface JobRole { key: string; label: string; description: string | null }
export interface Permission { key: string; label: string; category: string | null }
export interface RolePermission { job_role: string; permission_key: string; enabled: boolean }
export interface StaffRow { user_id: string; email: string | null; job_role: string; is_active: boolean; created_at: string }

export interface RolesCatalog {
  roles: JobRole[];
  permissions: Permission[];
  rolePermissions: RolePermission[];
  staff: StaffRow[];
}

const ROLE_KEY_RE = /^[a-z][a-z0-9_]{1,48}$/;

export async function getRolesCatalog(): Promise<RolesCatalog> {
  const admin = getSupabaseAdmin();
  const [roles, perms, rolePerms, staff] = await Promise.all([
    admin.from("staff_job_roles").select("key, label, description").order("label"),
    admin.from("permissions").select("key, label, category").order("category").order("label"),
    admin.from("role_permissions").select("job_role, permission_key, enabled"),
    listStaff(),
  ]);
  if (roles.error) throw new Error(`roles_query_failed: ${roles.error.message}`);
  if (perms.error) throw new Error(`permissions_query_failed: ${perms.error.message}`);
  if (rolePerms.error) throw new Error(`role_permissions_query_failed: ${rolePerms.error.message}`);
  return {
    roles: (roles.data ?? []) as JobRole[],
    permissions: (perms.data ?? []) as Permission[],
    rolePermissions: (rolePerms.data ?? []) as RolePermission[],
    staff,
  };
}

export async function createRole(input: { key: string; label: string; description?: string | null }): Promise<JobRole> {
  const key = input.key.trim().toLowerCase().replace(/\s+/g, "_");
  const label = input.label.trim();
  if (!ROLE_KEY_RE.test(key)) throw new Error("Role key must be lowercase letters/numbers/underscores (e.g. content_lead).");
  if (!label) throw new Error("Role label is required.");
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("staff_job_roles")
    .insert({ key, label, description: input.description?.trim() || null })
    .select("key, label, description")
    .single();
  if (error) throw new Error(error.code === "23505" ? `A role with key "${key}" already exists.` : error.message);
  return data as JobRole;
}

/** Edit an existing role's label/description. The key is immutable (it's the PK and
 *  FK target for role_permissions / staff_members). */
export async function updateRole(key: string, input: { label: string; description?: string | null }): Promise<JobRole> {
  const label = input.label.trim();
  if (!label) throw new Error("Role label is required.");
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("staff_job_roles")
    .update({ label, description: input.description?.trim() || null })
    .eq("key", key)
    .select("key, label, description")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`Role "${key}" not found.`);
  return data as JobRole;
}

export async function setRolePermission(job_role: string, permission_key: string, enabled: boolean): Promise<void> {
  if (job_role === "super_admin") throw new Error("super_admin's permissions are locked (it must retain full access).");
  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from("role_permissions")
    .upsert({ job_role, permission_key, enabled }, { onConflict: "job_role,permission_key" });
  if (error) throw new Error(error.message);
}

// ---- Staff ----

/** GoTrue admin: find an auth user by exact email (case-insensitive). Returns null
 *  if none. Uses the admin REST endpoint's email filter so it's precise regardless
 *  of how many auth users exist. */
async function findAuthUserByEmail(email: string): Promise<{ id: string; email: string } | null> {
  if (!SERVICE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?filter=${encodeURIComponent(email)}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!res.ok) throw new Error(`auth_lookup_failed_${res.status}`);
  const body = await res.json();
  const users: Array<{ id: string; email: string }> = body.users ?? [];
  const match = users.find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase());
  return match ?? null;
}

/** Staff list with resolved auth emails. staff_members holds only user_id/role/
 *  is_active; identity (email) lives in auth.users, resolved via the admin API. */
export async function listStaff(): Promise<StaffRow[]> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("staff_members")
    .select("user_id, job_role, is_active, created_at")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`staff_query_failed: ${error.message}`);
  const rows = (data ?? []) as Array<{ user_id: string; job_role: string; is_active: boolean; created_at: string }>;
  const withEmail = await Promise.all(
    rows.map(async (r) => {
      let email: string | null = null;
      try {
        const { data: u } = await admin.auth.admin.getUserById(r.user_id);
        email = u.user?.email ?? null;
      } catch { /* leave email null if the auth lookup fails */ }
      return { ...r, email };
    }),
  );
  return withEmail;
}

/**
 * Onboard a staff member: capture their email + assigned role, ensure an
 * auth.users record exists for that email (create one if not — email-confirmed, no
 * password; they sign in with the normal magic-link staff login), then upsert the
 * staff_members row. Idempotent on the user_id PK, so re-onboarding an email just
 * updates their role. Returns the resulting staff row + whether the auth user was
 * newly created.
 */
export async function onboardStaff(input: { email: string; job_role: string; is_active?: boolean }): Promise<{ staff: StaffRow; auth_user_created: boolean }> {
  const email = input.email.trim().toLowerCase();
  const job_role = input.job_role;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("A valid email is required.");
  const admin = getSupabaseAdmin();

  // job_role must be a real role (also FK-enforced, but give a clean error).
  const { data: role } = await admin.from("staff_job_roles").select("key").eq("key", job_role).maybeSingle();
  if (!role) throw new Error(`Unknown role "${job_role}".`);

  // find-or-create the auth user
  let userId: string;
  let created = false;
  const existing = await findAuthUserByEmail(email);
  if (existing) {
    userId = existing.id;
  } else {
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (error || !data.user) throw new Error(`Could not create the staff account: ${error?.message ?? "unknown"}`);
    userId = data.user.id;
    created = true;
  }

  const { data: staffRow, error: upErr } = await admin
    .from("staff_members")
    .upsert({ user_id: userId, job_role, is_active: input.is_active ?? true }, { onConflict: "user_id" })
    .select("user_id, job_role, is_active, created_at")
    .single();
  if (upErr) throw new Error(`Could not save the staff record: ${upErr.message}`);

  return { staff: { ...(staffRow as Omit<StaffRow, "email">), email }, auth_user_created: created };
}
