import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  OUTREACH_ATTR_COOKIE,
  readOutreachAttributionCookie,
  resolveOutreachAttributionSession,
} from "@/lib/outreach/attribution";

export const dynamic = "force-dynamic";

/**
 * Best-effort bridge from the ordinary signup flow to trusted outreach
 * attribution. The client supplies only the pending_signup_id that submit-consent
 * just created. Lead/campaign/touch identity comes exclusively from the HTTP-only
 * cookie written by /outreach/r and is re-resolved server-side.
 *
 * Attribution never changes eligibility, pricing, consent, or billing, and a
 * failure here must never undo a valid signup.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const pendingSignupId = typeof body.pending_signup_id === "string" ? body.pending_signup_id.trim() : "";
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(pendingSignupId)) {
      return NextResponse.json({ attached: false, reason: "invalid_pending_signup" }, { status: 400 });
    }

    const raw = (await cookies()).get(OUTREACH_ATTR_COOKIE)?.value;
    const sessionId = readOutreachAttributionCookie(raw);
    const session = await resolveOutreachAttributionSession(sessionId);
    if (!session) return NextResponse.json({ attached: false, reason: "no_valid_attribution" });

    const admin = getSupabaseAdmin();
    const { data: signup, error: readError } = await admin
      .from("pending_signups")
      .select("id, outreach_attribution_session_id, created_at")
      .eq("id", pendingSignupId)
      .maybeSingle();
    if (readError || !signup) return NextResponse.json({ attached: false, reason: "signup_not_found" }, { status: 404 });

    // Never overwrite a previously attached trusted source. Also refuse to attach
    // an old pending-signup row to a new browser visit.
    if (signup.outreach_attribution_session_id) {
      return NextResponse.json({ attached: signup.outreach_attribution_session_id === session.id, reason: "already_attached" });
    }
    if (Date.now() - new Date(signup.created_at).getTime() > 10 * 60 * 1000) {
      return NextResponse.json({ attached: false, reason: "signup_too_old" }, { status: 409 });
    }

    const { error: updateError } = await admin
      .from("pending_signups")
      .update({ outreach_attribution_session_id: session.id })
      .eq("id", pendingSignupId)
      .is("outreach_attribution_session_id", null);
    if (updateError) return NextResponse.json({ attached: false, reason: "update_failed" }, { status: 500 });

    return NextResponse.json({ attached: true });
  } catch {
    return NextResponse.json({ attached: false, reason: "unexpected_error" }, { status: 500 });
  }
}
