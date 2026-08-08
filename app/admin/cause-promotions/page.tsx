import { can } from "@/lib/rbac";
import Forbidden from "@/components/Forbidden";
import { getCausePromotionTotals } from "@/lib/causePromotions";
import CausePromotionsWidget from "./CausePromotionsWidget";

export const dynamic = "force-dynamic";

// Admin cause-promotion tracker. Revenue figures, so gated on analytics.revenue.view
// (super_admin only today), same tier as the KPI dashboard's revenue panels.
export default async function CausePromotionsPage() {
  if (!(await can("analytics.revenue.view"))) {
    return <Forbidden permission="analytics.revenue.view" />;
  }
  const totals = await getCausePromotionTotals();
  return <CausePromotionsWidget initialTotals={totals} />;
}
