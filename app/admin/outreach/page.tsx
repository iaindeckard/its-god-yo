import { can } from "@/lib/rbac";
import Forbidden from "@/components/Forbidden";
import { listCampaigns } from "@/lib/outreach/campaigns";
import OutreachManager from "./OutreachManager";

export const dynamic = "force-dynamic";

export default async function OutreachAdminPage() {
  if (!(await can("marketing.outreach.view"))) {
    return <Forbidden permission="marketing.outreach.view" />;
  }
  const [campaigns, canManage] = await Promise.all([listCampaigns(), can("marketing.outreach.manage")]);
  return <OutreachManager initialCampaigns={campaigns} canManage={canManage} />;
}
