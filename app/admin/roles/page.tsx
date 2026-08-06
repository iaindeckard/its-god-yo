import { can } from "@/lib/rbac";
import Forbidden from "@/components/Forbidden";
import { getRolesCatalog } from "@/lib/roleAdmin";
import RolesManager from "./RolesManager";

export const dynamic = "force-dynamic";

export default async function RolesPage() {
  if (!(await can("admin.roles.manage"))) {
    return <Forbidden permission="admin.roles.manage" />;
  }
  const catalog = await getRolesCatalog();
  return <RolesManager initialCatalog={catalog} />;
}
