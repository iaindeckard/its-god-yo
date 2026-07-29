import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase/publicEnv";

/**
 * Admin auth gate (replaces the old prod hard-block + deferred-login env stub).
 *
 * Refreshes the Supabase session on every /admin(/api) request and requires that
 * SOMEONE is logged in to reach the admin surface: unauthenticated page requests
 * redirect to /admin/login; unauthenticated API requests get 401. It does NOT
 * decide WHICH permission is needed — authorization is enforced per-route by
 * lib/rbac's requirePermission()/has_permission (a logged-in non-staff user still
 * gets 403 there, never a default role). There is no env switch to misconfigure.
 */
export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;

  if (!user && path.startsWith("/admin") && path !== "/admin/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }
  if (!user && path.startsWith("/api/admin")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return response;
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
