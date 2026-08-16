import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { getLead, replaceLeadContactEmail } from "@/lib/outreach/leads";
import { validateReplacementContactEmail, verifyLeads } from "@/lib/outreach/verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const staff = await requirePermission("marketing.outreach.verify_override");
    const { id } = await params;
    const lead = await getLead(id);
    if (!lead) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const body = await req.json().catch(() => ({}));
    const email = typeof body.email === "string" ? body.email : "";
    const sourceUrl = typeof body.source_url === "string" ? body.source_url : "";
    let validated: { email: string; sourceUrl: string };
    try {
      validated = await validateReplacementContactEmail(lead, email, sourceUrl);
      await replaceLeadContactEmail(lead, { ...validated, actorUserId: staff.userId });
    } catch (error) {
      const message = error instanceof Error ? error.message : "invalid contact email";
      const friendly = message === "contact_email_already_exists"
        ? "That email already belongs to another outreach lead."
        : message === "contact_email_edit_not_allowed"
          ? "This lead's lifecycle state does not allow its contact email to be changed."
          : message;
      return NextResponse.json({ error: friendly }, { status: 400 });
    }
    await verifyLeads({ ids: [lead.id] });
    return NextResponse.json({ lead: await getLead(lead.id) });
  } catch (error) {
    return apiError(error);
  }
}
