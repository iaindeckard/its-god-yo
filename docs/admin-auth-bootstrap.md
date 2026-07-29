# Admin auth — bootstrap & operations runbook (Phase 5)

Real staff authentication for `/admin`, replacing the old deferred-login /
`ADMIN_UNLOCK` stub. **Authentication** = Supabase magic-link (`signInWithOtp`);
**authorization** = the `has_permission()` SQL function over the RBAC matrix.
There is **no env stub and no default role** — a logged-in user with no
`staff_members` row is Forbidden on every permission.

Related: `supabase/migrations/20260729000005_admin_auth_staff_members.sql` (schema),
`lib/rbac.ts`, `middleware.ts`, `app/admin/login`, `app/auth/callback`.

## How a request is authorized

1. `middleware.ts` refreshes the Supabase session on every `/admin(/api)` request.
   No session → page requests redirect to `/admin/login`, API requests get `401`.
2. Per-route `requirePermission(key)` (or `can(key)`) in `lib/rbac.ts` calls the
   `has_permission(user_id, key)` RPC. Not a staff member → `403`. No fallback role.
3. `has_permission` resolution order: `staff_members.job_role` (must be `is_active`)
   → `user_permission_overrides` (per-user grant/deny wins) → `role_permissions`
   default → else `false`.

## One Supabase project

IGY dev and prod both point at the **same** Supabase project
(`bkwtlfkhfbfyzgnozixw`). A `staff_members` row seeded during local login is
therefore already live in prod — there is no separate prod seed step.

## Bootstrapping the first super_admin (done 2026-07-29)

The first admin can't be granted through the UI (no admin exists yet), so it is a
one-time manual seed after that person's first magic-link login:

1. The person signs in at `/admin/login` — this creates their `auth.users` row.
   Until seeded they see `/admin` with **no sections** (the "no default role" proof).
2. Seed them as `super_admin` (idempotent — safe to re-run):

```sql
insert into public.staff_members (user_id, job_role, is_active)
select id, 'super_admin', true
from auth.users
where lower(email) = 'iaindeckard@gmail.com'
on conflict (user_id) do update
  set job_role = excluded.job_role, is_active = true;
```

3. Refresh `/admin` — full nav renders, `super_admin` badge shows.

First super_admin: **iaindeckard@gmail.com**
(`auth.users.id = 6cf8d07c-7b91-468e-90a7-075e6ac52179`).

## Granting further staff

Same insert, choosing a `job_role` from `staff_job_roles`
(`super_admin` = all 27 permissions; `content_reviewer` = 8, review-only). The new
person must have logged in once first so their `auth.users` row exists:

```sql
-- content reviewer
insert into public.staff_members (user_id, job_role, is_active)
select id, 'content_reviewer', true
from auth.users where lower(email) = 'NEW_STAFF_EMAIL'
on conflict (user_id) do update
  set job_role = excluded.job_role, is_active = true;
```

Deactivate (revoke all access without deleting history):

```sql
update public.staff_members set is_active = false
where user_id = (select id from auth.users where lower(email) = 'STAFF_EMAIL');
```

Per-permission exceptions go in `user_permission_overrides` (a `granted` row wins
over the role default in `has_permission`).

## Verification (run after any grant)

```sql
-- expect: super_admin 27/27, a non-staff uuid 0/27
with keys as (select key from public.permissions)
select 'seeded'  as who, count(*) total,
       count(*) filter (where public.has_permission(
         (select id from auth.users where lower(email)='iaindeckard@gmail.com'), key)) granted
from keys
union all
select 'non-staff', count(*),
       count(*) filter (where public.has_permission('00000000-0000-0000-0000-000000000000', key))
from keys;
```

Phase 5 verified 2026-07-29: SMTP magic-link delivered, session set via
`/auth/callback`, pre-seed `/admin` showed no sections, post-seed super_admin got
27/27 and a non-staff uuid 0/27, logged-out `/admin` → `/admin/login`,
`/api/admin/*` → `401`.

## Deferred follow-on

The review **edge functions** (`lib/reviewFunctions.ts`) still authenticate with
the anon key rather than the signed-in user's JWT. Wiring them to the real user
session is a separate change, tracked outside this branch.
