import { NextResponse } from "next/server";
import { submitInquiry } from "@/lib/sponsorInquiry";
import { SPONSORS_ENABLED } from "@/lib/flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public sponsor lead-capture. Persists the inquiry + best-effort emails
 *  hello@itsgodyo.com. Not admin-gated; not a review/approval flow. */
export async function POST(req: Request) {
  // Sponsor Program deprioritized 2026-08-01 — reject public inquiries (see lib/flags).
  if (!SPONSORS_ENABLED) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  try {
    const res = await submitInquiry({
      orgName: body.org_name,
      contactName: body.contact_name,
      email: body.email,
      message: body.message,
    });
    return NextResponse.json({ ok: true, id: res.id });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "inquiry_failed" }, { status: 400 });
  }
}
