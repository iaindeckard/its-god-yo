import { can } from "@/lib/rbac";
import Forbidden from "@/components/Forbidden";
import { fetchCampaignPerformance, fetchCampaignSizePerformance } from "@/lib/outreach/performance";
import PerformanceLeaderboard from "./PerformanceLeaderboard";
import ReinvestmentPanel from "./ReinvestmentPanel";
import { listCampaigns } from "@/lib/outreach/campaigns";
import { getReinvestmentPolicy, listReinvestmentProposals } from "@/lib/outreach/reinvestment";

export const dynamic = "force-dynamic";

export default async function OutreachPerformancePage() {
  if (!(await can("marketing.outreach.view"))) {
    return <Forbidden permission="marketing.outreach.view" />;
  }
  const [campaigns, sizeRows, campaignFinance, policy, proposals, canManage, canApprove] = await Promise.all([
    fetchCampaignPerformance(),
    fetchCampaignSizePerformance(),
    listCampaigns(),
    getReinvestmentPolicy(),
    listReinvestmentProposals(),
    can("marketing.outreach.manage"),
    can("marketing.outreach.reinvestment.approve"),
  ]);
  return <><ReinvestmentPanel initialCampaigns={campaignFinance} initialPolicy={policy} initialProposals={proposals} canManage={canManage} canApprove={canApprove} /><PerformanceLeaderboard campaigns={campaigns} sizeRows={sizeRows} /></>;
}
