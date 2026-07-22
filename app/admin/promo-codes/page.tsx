import { can } from "@/lib/rbac";
import Forbidden from "@/components/Forbidden";
import { listPromoCodes } from "@/lib/promoCodes";
import { TIERS } from "@/lib/tiers";
import PromoCodeManager from "./PromoCodeManager";

export const dynamic = "force-dynamic";

export default async function PromoCodesPage() {
  if (!(await can("billing.promo_codes.view"))) {
    return <Forbidden permission="billing.promo_codes.view" />;
  }
  const [codes, canCreate, canDeactivate, canEdit, canViewRevenue] = await Promise.all([
    listPromoCodes(),
    can("billing.promo_codes.create"),
    can("billing.promo_codes.deactivate"),
    can("billing.promo_codes.edit"),
    can("analytics.revenue.view"),
  ]);

  // Tier data for the applicable-tiers selector (label only) and the ARR
  // simulator (annual value + pre-launch expected-redemption defaults).
  const tierOptions = TIERS.map((t) => ({ key: t.key, label: t.label }));
  const simTiers = TIERS.map((t) => ({
    key: t.key,
    label: t.label,
    annualUnitCents: t.annualUnitCents,
    defaultExpectedRedemptions: t.defaultExpectedRedemptions,
  }));

  return (
    <PromoCodeManager
      initialCodes={codes}
      canCreate={canCreate}
      canDeactivate={canDeactivate}
      canEdit={canEdit}
      canViewRevenue={canViewRevenue}
      tierOptions={tierOptions}
      simTiers={simTiers}
    />
  );
}
