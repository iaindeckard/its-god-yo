import Link from "next/link";
import { getCurrentStaff, getEffectivePermissions } from "@/lib/rbac";
import { getPendingTaskCounts } from "@/lib/pendingTasks";

export const dynamic = "force-dynamic";

const SECTIONS = [
  { href: "/admin/promo-codes", label: "Promo codes", need: "billing.promo_codes.view", desc: "Create and manage Stripe-native discount codes." },
  { href: "/admin/referrals", label: "Referrals", need: "billing.promo_codes.view", desc: "Give/get-a-month referral loop — events, rewards, cap." },
  { href: "/admin/review", label: "Review queue", need: "content.queue.view", desc: "Approve or reject flagged daily-verse slots." },
  { href: "/admin/dashboard", label: "KPI dashboard", need: "analytics.dashboard.view", desc: "Subscribers, MRR, funnel, backlog." },
  { href: "/admin/consent-thresholds", label: "Consent thresholds", need: "admin.consent_thresholds.manage", desc: "Per-country age-consent rules (fail-safe until counsel confirms)." },
];

export default async function AdminHome() {
  const staff = await getCurrentStaff();
  const perms = staff ? await getEffectivePermissions(staff) : new Set<string>();
  const visible = SECTIONS.filter((s) => perms.has(s.need));

  // Tier 1 "needs attention" summary — the same centralized pending-tasks
  // computation that badges the sidebar, listed here on the landing page. Shows a
  // queue when it has items AND the viewer can act on it: a screened queue needs
  // its permission; a no-screen queue (outreach) is informational, shown only to
  // the super-admin surface so it doesn't leak to limited roles.
  const pending = staff
    ? await getPendingTaskCounts().catch(() => [])
    : [];
  const attention = pending.filter(
    (p) => p.count > 0 && (p.navHref ? perms.has(p.need) : perms.has("admin.roles.manage")),
  );

  return (
    <>
      <div className="admin-head">
        <h1>Admin</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <span className="role-badge">{staff?.jobRole ?? "no role"}</span>
        </div>
      </div>

      {attention.length > 0 && (
        <div className="card" style={{ marginBottom: "var(--space-5)" }}>
          <div className="plan-name" style={{ marginBottom: 10 }}>Needs attention</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {attention.map((a) =>
              a.navHref ? (
                <Link key={a.key} href={a.navHref} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, textDecoration: "none", color: "inherit" }}>
                  <span>{a.label}</span>
                  <span className="nav-count">{a.count}</span>
                </Link>
              ) : (
                <div key={a.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span className="muted">{a.label} <span style={{ fontSize: 12 }}>(no screen yet)</span></span>
                  <span className="nav-count">{a.count}</span>
                </div>
              ),
            )}
          </div>
        </div>
      )}

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
