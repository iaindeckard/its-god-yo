import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Admin surface hard-block. The admin panel has no real login yet — getCurrentStaff()
 * in lib/rbac.ts defaults the acting identity to `super_admin` (deferred-login seam).
 * Deploying that as-is would expose /admin and /api/admin/* to the public, wide open.
 *
 * Until a session-based staff login exists, block those paths in any deployed
 * (production) environment. Set the ADMIN_UNLOCK env var to a non-empty value to
 * re-enable them deliberately (e.g. behind a trusted network). Local dev
 * (NODE_ENV !== "production") is unaffected so the panel stays usable while building.
 */
export function middleware(_req: NextRequest) {
  const isProd = process.env.NODE_ENV === "production";
  const unlocked = Boolean(process.env.ADMIN_UNLOCK);
  if (isProd && !unlocked) {
    return new NextResponse("Not found", { status: 404 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
