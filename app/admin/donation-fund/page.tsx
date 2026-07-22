import { can } from "@/lib/rbac";
import Forbidden from "@/components/Forbidden";
import { getFundSummary } from "@/lib/donationFund";
import DonationFundManager from "./DonationFundManager";

export const dynamic = "force-dynamic";

export default async function DonationFundPage() {
  if (!(await can("finance.donation_fund.view"))) {
    return <Forbidden permission="finance.donation_fund.view" />;
  }
  const [summary, canDisburse] = await Promise.all([
    getFundSummary(),
    can("finance.donation_fund.disburse"),
  ]);
  return <DonationFundManager initialSummary={summary} canDisburse={canDisburse} />;
}
