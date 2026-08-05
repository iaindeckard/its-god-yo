import { NextResponse } from "next/server";
import { CORNERSTONE_ENABLED } from "@/lib/flags";
import {
  verifyEnrollmentToken, isActivePartner, getOrCreateEnrollmentLink, resolvePartnerByShortCode,
} from "@/lib/churchEnrollment";
import {
  CHURCH_ENROLL_COOKIE, CHURCH_ENROLL_COOKIE_MAX_AGE, serializeChurchCookie,
} from "@/lib/churchEnrollmentCookie";

export const dynamic = "force-dynamic";

/**
 * Church group enrollment entry point. A teen arrives here from a link their
 * minister shared — either the full token link (?c=<partner-uuid>&t=<token>) or a
 * short code (?code=ABCD-2345). We VALIDATE server-side, drop a trusted cookie
 * naming the Cornerstone partner, and send the teen into the normal signup flow.
 * The signup is otherwise unchanged — same gate, same self-entered info, same
 * price. Attribution only. On any failure we route to /join/enter (type a code)
 * rather than leaking whether a given partner/code exists.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const enterUrl = new URL("/join/enter", url);
  const signupUrl = new URL("/signup", url);

  if (!CORNERSTONE_ENABLED) return NextResponse.redirect(new URL("/", url));

  let partnerId: string | null = null;
  let linkId: string | null = null;

  try {
    const c = url.searchParams.get("c");
    const t = url.searchParams.get("t");
    const code = url.searchParams.get("code");

    if (c && t) {
      // Full token link. Verify the HMAC, then confirm the partner is active.
      if (verifyEnrollmentToken(c, t) && (await isActivePartner(c))) {
        partnerId = c;
        // Ensure a link row exists so we can attribute enrollment_link_id + the
        // church dashboard has a short code to show. Idempotent.
        const link = await getOrCreateEnrollmentLink(c);
        linkId = link.id;
      }
    } else if (code) {
      const resolved = await resolvePartnerByShortCode(code);
      if (resolved && (await isActivePartner(resolved.partnerId))) {
        partnerId = resolved.partnerId;
        linkId = resolved.linkId;
      }
    }
  } catch {
    // Any lookup failure → treat as unresolved; never 500 a teen out of signing up.
    partnerId = null;
  }

  if (!partnerId) {
    // Missing/invalid params: send them to the "enter your church code" page,
    // preserving a bad code so it can show a gentle "we didn't recognize that".
    const bad = url.searchParams.get("code");
    if (bad) enterUrl.searchParams.set("code", bad);
    return NextResponse.redirect(enterUrl);
  }

  const res = NextResponse.redirect(signupUrl);
  res.cookies.set(CHURCH_ENROLL_COOKIE, serializeChurchCookie(partnerId, linkId), {
    path: "/",
    maxAge: CHURCH_ENROLL_COOKIE_MAX_AGE,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}
