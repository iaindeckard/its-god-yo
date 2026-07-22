import { can } from "@/lib/rbac";
import Forbidden from "@/components/Forbidden";
import { getTrackSummaries } from "@/lib/themeTags";
import TagReviewManager from "./TagReviewManager";

export const dynamic = "force-dynamic";

export default async function ThemeTagsPage() {
  if (!(await can("content.theme_tags.view"))) {
    return <Forbidden permission="content.theme_tags.view" />;
  }
  const [summaries, canReview] = await Promise.all([
    getTrackSummaries(),
    can("content.theme_tags.review"),
  ]);
  return <TagReviewManager initialSummaries={summaries} canReview={canReview} />;
}
