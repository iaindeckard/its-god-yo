import Link from "next/link";
import { getCurrentStaff, getEffectivePermissions } from "@/lib/rbac";

export const dynamic = "force-dynamic";

const SECTIONS = [
  { href: "/admin/promo-codes", label: "Promo codes", need: "billing.promo_codes.view", desc: "Create and manage Stripe-native discount codes." },
  { href: "/admin/referrals", label: "Referrals", need: "billing.promo_codes.view", desc: "Give/get-a-month referral loop — events, rewards, cap." },
  { href: "/admin/review", label: "Review queue", need: "content.queue.view", desc: "Approve or reject flagged daily-verse slots." },
  { href: "/admin/dashboard", label: "KPI dashboard", need: "analytics.dashboard.view", desc: "Subscribers, MRR, funnel, backlog." },
  { href: "/admin/consent-thresholds", label: "Consent thresholds", need: "admin.consent_thresholds.manage", desc: "Per-country age-consent rules (fail-safe until counsel confirms)." },
  { href: "/admin/preorder", label: "Preorder launch", need: "billing.preorder.launch", desc: "Fire the one-time launch trigger — invite all reservations to reply YES." },
];

export default async function AdminHome() {
  const staff = await getCurrentStaff();
  const perms = staff ? await getEffectivePermissions(staff) : new Set<string>();
  const visible = SECTIONS.filter((s) => perms.has(s.need));

  return (
    <>
      <div className="admin-head">
        <h1>Admin</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <span className="role-badge">{staff?.jobRole ?? "no role"}</span>
        </div>
      </div>
      <div className="grid cols-3">
        {visible.map((s) => (
          <Link key={s.href} href={s.href} className="card" style={{ textDecoration: "none", color: "inherit" }}>
            <div className="plan-name">{s.label}</div>
            <p className="muted" style={{ margin: 0, fontSize: 14 }}>{s.desc}</p>
          </Link>
        ))}
        {visible.length === 0 && <p className="muted">This account has no admin sections enabled.</p>}
      </div>
    </>
  );
}
