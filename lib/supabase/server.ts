import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./publicEnv";

/**
 * Server-side Supabase client bound to the request's auth cookies (@supabase/ssr).
 * Used by lib/rbac.ts (getUser + has_permission RPC) and the auth callback. The
 * session identity comes from the cookie — there is no env stub / default role.
 */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component (read-only cookies) — safe to ignore;
          // the middleware is what refreshes the session cookie on the response.
        }
      },
    },
  });
}
