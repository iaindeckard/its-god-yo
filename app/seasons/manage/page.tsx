import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { verifySeasonManageToken } from "@/lib/seasons/token";
import { getCustomerEnrollments } from "@/lib/seasons/enrollment";
import SeasonAddOns from "@/components/SeasonAddOns";
import { toggleSeasonAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Holy Season add-ons" };

export default async function SeasonsManagePage({ searchParams }: { searchParams: Promise<{ c?: string; t?: string }> }) {
  const { c, t } = await searchParams;
  if (!c || !t || !verifySeasonManageToken(c, t)) {
    return (
      <main style={{ maxWidth: 560, margin: "40px auto", padding: 20 }}>
        <h1>Link invalid</h1>
        <p>This season-management link is invalid or has expired.</p>
      </main>
    );
  }
  const enrollments = await getCustomerEnrollments(getSupabaseAdmin(), c);
  const initial = Object.fromEntries(Object.entries(enrollments).map(([k, v]) => [k, { status: v.status }]));
  return (
    <main>
      <SeasonAddOns customerId={c} token={t} initial={initial} onToggle={toggleSeasonAction} />
    </main>
  );
}
