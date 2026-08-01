import { can } from "@/lib/rbac";
import Forbidden from "@/components/Forbidden";
import { listApplications, listPartners, getConfig } from "@/lib/cornerstone";
import CornerstoneManager from "./CornerstoneManager";

export const dynamic = "force-dynamic";

export default async function CornerstoneAdminPage() {
  if (!(await can("partners.view"))) {
    return <Forbidden permission="partners.view" />;
  }
  const [applications, partners, config, canReview, canManage] = await Promise.all([
    listApplications(),
    listPartners(),
    getConfig(),
    can("partners.review"),
    can("partners.manage"),
  ]);
  return (
    <CornerstoneManager
      initialApplications={applications}
      initialPartners={partners}
      initialConfig={config}
      canReview={canReview}
      canManage={canManage}
    />
  );
}
