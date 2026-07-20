import { can } from "@/lib/rbac";
import Forbidden from "@/components/Forbidden";
import { listPromoCodes } from "@/lib/promoCodes";
import PromoCodeManager from "./PromoCodeManager";

export const dynamic = "force-dynamic";

export default async function PromoCodesPage() {
  if (!(await can("billing.promo_codes.view"))) {
    return <Forbidden permission="billing.promo_codes.view" />;
  }
  const [codes, canCreate, canDeactivate, canEdit] = await Promise.all([
    listPromoCodes(),
    can("billing.promo_codes.create"),
    can("billing.promo_codes.deactivate"),
    can("billing.promo_codes.edit"),
  ]);
  return (
    <PromoCodeManager
      initialCodes={codes}
      canCreate={canCreate}
      canDeactivate={canDeactivate}
      canEdit={canEdit}
    />
  );
}
