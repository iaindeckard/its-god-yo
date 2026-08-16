import { can } from "@/lib/rbac";
import Forbidden from "@/components/Forbidden";
import { listCampaigns } from "@/lib/outreach/campaigns";
import OutreachManager from "./OutreachManager";
import { getAiUsageSummary } from "@/lib/ai-usage";

export const dynamic = "force-dynamic";

export default async function OutreachAdminPage() {
  if (!(await can("marketing.outreach.view"))) {
    return <Forbidden permission="marketing.outreach.view" />;
  }
  const [campaigns, canManage, canOverride, aiUsage] = await Promise.all([
    listCampaigns(),
    can("marketing.outreach.manage"),
    can("marketing.outreach.verify_override"),
    getAiUsageSummary(),
  ]);
  return <OutreachManager initialCampaigns={campaigns} canManage={canManage} canOverride={canOverride} initialAiUsage={aiUsage} />;
}
