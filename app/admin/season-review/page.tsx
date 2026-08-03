import { can } from "@/lib/rbac";
import Forbidden from "@/components/Forbidden";
import { getSeasonReviewBatches } from "@/lib/seasons/reviewData";
import SeasonReviewClient from "./SeasonReviewClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Season Review — It's God, Yo!" };

export default async function SeasonReviewPage() {
  if (!(await can("content.queue.view"))) return <Forbidden permission="content.queue.view" />;
  const [batches, approve, reject, generate] = await Promise.all([
    getSeasonReviewBatches(),
    can("content.queue.approve"),
    can("content.queue.reject_verse"),
    can("content.generate"),
  ]);
  return <SeasonReviewClient batches={batches} perms={{ approve, reject, generate }} />;
}
