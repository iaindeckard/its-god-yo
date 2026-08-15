import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  OUTREACH_ATTR_COOKIE,
  OUTREACH_ATTR_COOKIE_MAX_AGE,
  verifyOutreachAttributionToken,
  type OutreachLanguage,
  type OutreachTouch,
} from "@/lib/outreach/attribution";

export const dynamic = "force-dynamic";

/**
 * Trusted outreach entry point. Reviewed email copy links here instead of directly
 * to the homepage. A valid, time-bounded HMAC proves the lead/touch pair came from
 * IGY, then the server resolves campaign identity from the lead row and records an
 * opaque attribution session. The visitor still lands on the normal homepage;
 * pricing, signup, consent and eligibility are unchanged.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const home = new URL("/", url);
  const leadId = url.searchParams.get("lead") || "";
  const token = url.searchParams.get("t") || "";
  const expiresUnix = Number(url.searchParams.get("exp"));
  const touchRaw = Number(url.searchParams.get("touch"));
  const langRaw = url.searchParams.get("lang");
  const touch: OutreachTouch | null = touchRaw === 1 || touchRaw === 2 ? touchRaw : null;
  const language: OutreachLanguage | null = langRaw === "en" || langRaw === "es" ? langRaw : null;

  // Never expose whether a lead/token exists. Invalid or expired entry simply
  // becomes an ordinary homepage visit and carries no attribution.
  if (!touch || !language || !verifyOutreachAttributionToken(leadId, touch, language, expiresUnix, token)) {
    return NextResponse.redirect(home);
  }

  try {
    const admin = getSupabaseAdmin();
    const { data: lead, error: leadError } = await admin
      .from("igy_outreach_leads")
      .select("id, campaign_id")
      .eq("id", leadId)
      .maybeSingle();

    if (leadError || !lead?.campaign_id) return NextResponse.redirect(home);

    const { data: session, error: sessionError } = await admin
      .from("outreach_attribution_sessions")
      .insert({
        lead_id: lead.id,
        campaign_id: lead.campaign_id,
        touch,
        language,
      })
      .select("id")
      .single();

    if (sessionError || !session?.id) return NextResponse.redirect(home);

    const res = NextResponse.redirect(home);
    res.cookies.set(OUTREACH_ATTR_COOKIE, session.id, {
      path: "/",
      maxAge: OUTREACH_ATTR_COOKIE_MAX_AGE,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
    return res;
  } catch {
    // Attribution must never break a prospect's ability to reach the public site.
    return NextResponse.redirect(home);
  }
}
