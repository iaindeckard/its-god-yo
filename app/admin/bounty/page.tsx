import { can } from "@/lib/rbac";
import Forbidden from "@/components/Forbidden";
import { getReviewGroups, getBountyLedger } from "@/lib/bounty";
import BountyManager from "./BountyManager";

export const dynamic = "force-dynamic";

export default async function BountyPage() {
  if (!(await can("finance.bounty.view"))) {
    return <Forbidden permission="finance.bounty.view" />;
  }
  const [groups, ledger, canReview] = await Promise.all([
    getReviewGroups("pending"),
    getBountyLedger(),
    can("finance.bounty.review"),
  ]);
  return <BountyManager initialGroups={groups} initialLedger={ledger} canReview={canReview} />;
}
