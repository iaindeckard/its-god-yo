import Link from "next/link";
import { getCurrentStaff, getEffectivePermissions } from "@/lib/rbac";

export const dynamic = "force-dynamic";

const SECTIONS = [
  { href: "/admin/promo-codes", label: "Promo codes", need: "billing.promo_codes.view", desc: "Create and manage Stripe-native discount codes." },
  { href: "/admin/referrals", label: "Referrals", need: "billing.promo_codes.view", desc: "Give/get-a-month referral loop — events, rewards, cap." },
  { href: "/admin/review", label: "Review queue", need: "content.queue.view", desc: "Approve or reject flagged daily-verse slots." },
  { href: "/admin/dashboard", label: "KPI dashboard", need: "analytics.dashboard.view", desc: "Subscribers, MRR, funnel, backlog." },
  { href: "/admin/consent-thresholds", label: "Consent thresholds", need: "admin.consent_thresholds.manage", desc: "Per-country age-consent rules (fail-safe until counsel confirms)." },
];

export default async function AdminHome() {
  const staff = getCurrentStaff();
  const perms = await getEffectivePermissions(staff);
  const visible = SECTIONS.filter((s) => perms.has(s.need));

  return (
    <>
      <div className="admin-head">
        <h1>Admin</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <span className="role-badge">{staff.jobRole}</span>
          <span className="dev-badge">DEV IDENTITY (login deferred)</span>
        </div>
      </div>
      <div className="admin-note">
        Staff login isn&rsquo;t wired yet, so the acting identity comes from <span className="mono">ADMIN_DEV_ROLE</span>.
        Permission gating below is real — it reads <span className="mono">role_permissions</span> from the database for
        the acting role. Swap in a session-based identity when login lands and nothing else changes.
      </div>
      <div className="grid cols-3">
        {visible.map((s) => (
          <Link key={s.href} href={s.href} className="card" style={{ textDecoration: "none", color: "inherit" }}>
            <div className="plan-name">{s.label}</div>
            <p className="muted" style={{ margin: 0, fontSize: 14 }}>{s.desc}</p>
          </Link>
        ))}
        {visible.length === 0 && <p className="muted">Your role has no admin sections enabled.</p>}
      </div>
    </>
  );
}
