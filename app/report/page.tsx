import type { Metadata } from "next";
import ReportForm from "./ReportForm";

export const metadata: Metadata = {
  title: "Report an issue — It's God, Yo!",
  description: "Spot a translation or wording issue in a daily text? Tell us. If it's confirmed, the first person to report it earns an account credit.",
};

export const dynamic = "force-dynamic";

/**
 * Public "report an issue" page. In practice a daily-text SMS footer links here
 * with the verse/date/track pre-filled via query params; the reporter just adds
 * their email + what's wrong. Submitting never pays out automatically — it
 * enters the human review queue.
 */
export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ verse_ref?: string; theme_track?: string; report_date?: string; text?: string }>;
}) {
  const sp = await searchParams;
  return (
    <ReportForm
      defaults={{
        verseRef: sp.verse_ref ?? "",
        themeTrack: sp.theme_track ?? "general",
        reportDate: sp.report_date ?? "",
        reportedText: sp.text ?? "",
      }}
    />
  );
}
