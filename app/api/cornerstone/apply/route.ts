import { NextResponse } from "next/server";
import { submitApplication, getConfig } from "@/lib/cornerstone";
import { CORNERSTONE_ENABLED } from "@/lib/flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public Cornerstone Partner application intake. Persists a church + a
 * 'submitted' application. Server-side validation only — never trust the client.
 * Gated by CORNERSTONE_ENABLED (404 when the program isn't open).
 */
export async function POST(req: Request) {
  if (!CORNERSTONE_ENABLED) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));

  // Honeypot: a hidden field real users never fill. Bots that autofill it get a
  // silent success (no row written) so they don't retry.
  if (typeof body.company_website_confirm === "string" && body.company_website_confirm.trim() !== "") {
    return NextResponse.json({ ok: true });
  }

  // Required, server-enforced.
  if (!body.church_name?.trim()) {
    return NextResponse.json({ ok: false, error: "Church name is required." }, { status: 400 });
  }
  if (!body.authorization_confirmed) {
    return NextResponse.json({ ok: false, error: "You must confirm you're authorized to act for the church." }, { status: 400 });
  }
  if (!body.terms_agreed) {
    return NextResponse.json({ ok: false, error: "You must agree to the Cornerstone Partner terms." }, { status: 400 });
  }
  if (!body.contact_email?.trim()) {
    return NextResponse.json({ ok: false, error: "A contact email is required." }, { status: 400 });
  }

  // The agreed terms VERSION comes from server config, not the client.
  let termsVersion = "v1-draft";
  try { termsVersion = (await getConfig()).terms_version; } catch { /* keep default */ }

  const toInt = (v: unknown) => {
    const n = typeof v === "number" ? v : parseInt(String(v ?? "").trim(), 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  try {
    const { applicationId } = await submitApplication({
      church: {
        name: body.church_name,
        website: body.website ?? null,
        address: body.address ?? null,
        city: body.city ?? null,
        state_province: body.state_province ?? null,
        postal_code: body.postal_code ?? null,
        country: body.country ?? null,
        denomination: body.denomination ?? null,
        estimated_attendance: toInt(body.estimated_attendance),
        estimated_youth_group_size: toInt(body.estimated_youth_group_size),
        public_recognition_opt_in: !!body.public_recognition_opt_in,
        logo_display_opt_in: !!body.logo_display_opt_in,
      },
      contact_name: body.contact_name ?? null,
      contact_title: body.contact_title ?? null,
      contact_salutation: Array.isArray(body.contact_salutation) ? body.contact_salutation : null,
      contact_email: body.contact_email ?? null,
      contact_phone: body.contact_phone ?? null,
      existing_account_email: body.existing_account_email ?? null,
      preferred_plan: body.preferred_plan ?? null,
      terms_version_accepted: termsVersion,
      authorization_confirmed: true,
    });
    return NextResponse.json({ ok: true, applicationId });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "application_failed" }, { status: 400 });
  }
}
