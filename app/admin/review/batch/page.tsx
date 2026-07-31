import { can } from "@/lib/rbac";
import Forbidden from "@/components/Forbidden";
import { getBatchSlots } from "@/lib/reviewBatch";
import BatchReview from "./BatchReview";

export const dynamic = "force-dynamic";

/**
 * Proactive full-batch review. Unlike /admin/review (exceptions only), this shows
 * EVERY slot for a track + optional date window so the whole upcoming batch can be
 * approved day by day — including AI-agreed days the exceptions queue never lists.
 * Filters come from the query string: ?track=general&from=YYYY-MM-DD&to=YYYY-MM-DD
 */
export default async function BatchReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ track?: string; from?: string; to?: string }>;
}) {
  if (!(await can("content.queue.view"))) return <Forbidden permission="content.queue.view" />;

  const sp = await searchParams;
  const track = sp.track?.trim() || "general";
  const from = sp.from?.trim() || null;
  const to = sp.to?.trim() || null;

  const [result, approve, rejectVerse, rejectTranslation] = await Promise.all([
    getBatchSlots({ track, from, to }),
    can("content.queue.approve"),
    can("content.queue.reject_verse"),
    can("content.queue.reject_translation"),
  ]);

  return <BatchReview result={result} perms={{ approve, rejectVerse, rejectTranslation }} />;
}
