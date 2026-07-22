import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { listSponsors, createSponsor } from "@/lib/sponsors";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requirePermission("marketing.sponsors.view");
    return NextResponse.json({ sponsors: await listSponsors() });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    await requirePermission("marketing.sponsors.manage");
    const body = await req.json().catch(() => ({}));
    if (!body.name?.trim()) return NextResponse.json({ error: "name is required" }, { status: 400 });
    if (!body.logo_url?.trim()) return NextResponse.json({ error: "logo_url is required" }, { status: 400 });
    const sponsor = await createSponsor({
      name: body.name,
      logo_url: body.logo_url,
      contact_email: body.contact_email,
      start_date: body.start_date,
      end_date: body.end_date,
      status: body.status,
      vetting_notes: body.vetting_notes,
      amount_cents: body.amount_cents ? Number(body.amount_cents) : null,
      billing_note: body.billing_note,
      stripe_customer_id: body.stripe_customer_id,
    });
    return NextResponse.json({ sponsor });
  } catch (e) {
    return apiError(e);
  }
}
