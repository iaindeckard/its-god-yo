import { can } from "@/lib/rbac";
import Forbidden from "@/components/Forbidden";
import { listSponsors } from "@/lib/sponsors";
import SponsorManager from "./SponsorManager";

export const dynamic = "force-dynamic";

export default async function SponsorsAdminPage() {
  if (!(await can("marketing.sponsors.view"))) {
    return <Forbidden permission="marketing.sponsors.view" />;
  }
  const [sponsors, canManage] = await Promise.all([listSponsors(), can("marketing.sponsors.manage")]);
  return <SponsorManager initialSponsors={sponsors} canManage={canManage} />;
}
