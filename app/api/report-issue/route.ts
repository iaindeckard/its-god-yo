import { NextResponse } from "next/server";
import { submitReport } from "@/lib/bounty";

export const dynamic = "force-dynamic";

/**
 * Public endpoint: a subscriber reports a translation/reword issue with a daily
 * text. NOT admin-gated — anyone can report. A report never pays out on its own;
 * it enters the human review queue. Rate limiting is by the review step + the
 * per-person monthly credit cap, not by blocking submissions.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  try {
    const report = await submitReport({
      reporterEmail: body.reporter_email,
      verseRef: body.verse_ref,
      themeTrack: body.theme_track,
      reportDate: body.report_date,
      textLang: body.text_lang,
      reportedText: body.reported_text,
      description: body.description,
    });
    return NextResponse.json({
      ok: true,
      report_id: report.id,
      message: "Thanks! Your report was received. If it's confirmed, the first person to report it earns a credit.",
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "report_failed" }, { status: 400 });
  }
}
