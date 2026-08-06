import { can } from "@/lib/rbac";
import Forbidden from "@/components/Forbidden";
import { getPronounSummary, getPronounProposals } from "@/lib/pronounReview";
import PronounReviewManager from "./PronounReviewManager";

export const dynamic = "force-dynamic";

export default async function PronounReviewPage() {
  if (!(await can("content.queue.view"))) {
    return <Forbidden permission="content.queue.view" />;
  }
  const [summary, proposals, canReview] = await Promise.all([
    getPronounSummary(),
    getPronounProposals("proposed"),
    can("content.queue.approve"),
  ]);
  return <PronounReviewManager initialSummary={summary} initialProposals={proposals} canReview={canReview} />;
}
