import { can } from "@/lib/rbac";
import Forbidden from "@/components/Forbidden";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import PreorderLaunch from "./PreorderLaunch";

export const dynamic = "force-dynamic";

const STATES = ["preorder_pending", "awaiting_confirmation", "payment_failed", "active", "removed"] as const;

export default async function PreorderPage() {
  const PERM = "billing.preorder.launch";
  if (!(await can(PERM))) return <Forbidden permission={PERM} />;

  const admin = getSupabaseAdmin();
  const counts: Record<string, number> = {};
  await Promise.all(
    STATES.map(async (st) => {
      const { count } = await admin
        .from("pending_signups")
        .select("id", { count: "exact", head: true })
        .eq("is_preorder", true)
        .eq("status", st);
      counts[st] = count ?? 0;
    }),
  );

  return <PreorderLaunch initialCounts={counts} />;
}
