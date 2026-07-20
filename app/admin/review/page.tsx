import { can } from "@/lib/rbac";
import Forbidden from "@/components/Forbidden";
import { getReviewQueue } from "@/lib/reviewQueue";
import ReviewQueue from "./ReviewQueue";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  if (!(await can("content.queue.view"))) return <Forbidden permission="content.queue.view" />;
  const [slots, approve, rejectVerse, rejectTranslation] = await Promise.all([
    getReviewQueue(),
    can("content.queue.approve"),
    can("content.queue.reject_verse"),
    can("content.queue.reject_translation"),
  ]);
  return <ReviewQueue initialSlots={slots} perms={{ approve, rejectVerse, rejectTranslation }} />;
}
