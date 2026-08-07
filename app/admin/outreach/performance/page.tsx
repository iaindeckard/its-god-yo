import { can } from "@/lib/rbac";
import Forbidden from "@/components/Forbidden";
import { fetchCampaignPerformance, fetchCampaignSizePerformance } from "@/lib/outreach/performance";
import PerformanceLeaderboard from "./PerformanceLeaderboard";

export const dynamic = "force-dynamic";

export default async function OutreachPerformancePage() {
  if (!(await can("marketing.outreach.view"))) {
    return <Forbidden permission="marketing.outreach.view" />;
  }
  const [campaigns, sizeRows] = await Promise.all([
    fetchCampaignPerformance(),
    fetchCampaignSizePerformance(),
  ]);
  return <PerformanceLeaderboard campaigns={campaigns} sizeRows={sizeRows} />;
}
