import { can } from "@/lib/rbac";
import Forbidden from "@/components/Forbidden";
import { getReviewGroups, getBountyLedger, getBountyCorrections } from "@/lib/bounty";
import BountyManager from "./BountyManager";

export const dynamic = "force-dynamic";

export default async function BountyPage() {
  if (!(await can("finance.bounty.view"))) {
    return <Forbidden permission="finance.bounty.view" />;
  }
  const [groups, ledger, corrections, canReview, canPublish] = await Promise.all([
    getReviewGroups("pending"),
    getBountyLedger(),
    getBountyCorrections(),
    can("finance.bounty.review"),
    can("content.queue.publish"),
  ]);
  return (
    <BountyManager
      initialGroups={groups}
      initialLedger={ledger}
      initialCorrections={corrections}
      canReview={canReview}
      canPublish={canPublish}
    />
  );
}
