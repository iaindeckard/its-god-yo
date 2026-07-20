import { can } from "@/lib/rbac";
import Forbidden from "@/components/Forbidden";
import { listThresholds } from "@/lib/consentThresholds";
import ConsentThresholdsManager from "./ConsentThresholdsManager";

export const dynamic = "force-dynamic";

export default async function ConsentThresholdsPage() {
  if (!(await can("admin.consent_thresholds.manage"))) {
    return <Forbidden permission="admin.consent_thresholds.manage" />;
  }
  return <ConsentThresholdsManager initial={await listThresholds()} />;
}
