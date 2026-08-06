import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { apiError } from "@/lib/apiError";
import { getPronounSummary, getPronounProposals } from "@/lib/pronounReview";

export const dynamic = "force-dynamic";

/** Divine-pronoun correction batch: summary + proposals at a status (default 'proposed'). */
export async function GET(req: Request) {
  try {
    await requirePermission("content.queue.view");
    const status = new URL(req.url).searchParams.get("status") || "proposed";
    const [summary, proposals] = await Promise.all([getPronounSummary(), getPronounProposals(status)]);
    return NextResponse.json({ summary, status, proposals });
  } catch (e) {
    return apiError(e);
  }
}
