import Link from "next/link";
import Wordmark from "@/components/Wordmark";
import { getCurrentStaff, getEffectivePermissions } from "@/lib/rbac";
import { getPendingCountsByHref } from "@/lib/pendingTasks";

export const metadata = { title: "Admin — It's God, Yo!" };
export const dynamic = "force-dynamic"; // identity/permissions resolve per-request, never at build

const NAV = [
  { href: "/admin/promo-codes", label: "Promo Code Studio", need: "billing.promo_codes.view" },
  { href: "/admin/referrals", label: "Referrals", need: "billing.promo_codes.view" },
  { href: "/admin/review", label: "Review queue", need: "content.queue.view" },
  { href: "/admin/season-review", label: "Season Review", need: "content.queue.view" },
  { href: "/admin/theme-tags", label: "Theme tags", need: "content.theme_tags.view" },
  { href: "/admin/pronoun-review", label: "Pronoun corrections", need: "content.queue.view" },
  { href: "/admin/dashboard", label: "KPI dashboard", need: "analytics.dashboard.view" },
  { href: "/admin/donation-fund", label: "Donation Fund", need: "finance.donation_fund.view" },
  { href: "/admin/bounty", label: "Error bounty", need: "finance.bounty.view" },
  { href: "/admin/sponsors", label: "Sponsors", need: "marketing.sponsors.view" },
  { href: "/admin/outreach", label: "Outreach campaigns", need: "marketing.outreach.view" },
  { href: "/admin/cornerstone", label: "Cornerstone Partners", need: "partners.view" },
  { href: "/admin/consent-thresholds", label: "Consent thresholds", need: "admin.consent_thresholds.manage" },
  { href: "/admin/roles", label: "Roles & staff", need: "admin.roles.manage" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const staff = await getCurrentStaff();
  const perms = staff ? await getEffectivePermissions(staff) : new Set<string>();
  const nav = NAV.filter((n) => perms.has(n.need));
  // Tier 1 badges: one centralized pending-tasks computation, keyed by nav href.
  // Best-effort — a failure must not break the shell, so fall back to no badges.
  const pending = staff ? await getPendingCountsByHref().catch(() => ({} as Record<string, number>)) : {};

  return (
    <div className="admin-shell">
      <aside className="admin-side">
        {/* Locked-spec wordmark: "It's God, Yo" + the bubble-and-bang mark AS the
            "!" (Wordmark renders the BubbleMark for us). No separate leading
            BubbleMark — that produced a redundant second bubble that made the
            wordmark's own "!" read as a repeat rather than the terminal mark. */}
        <Link href="/admin" className="brand" style={{ textDecoration: "none" }}>
          <Wordmark tone="brass" />
        </Link>
        <div style={{ fontSize: 12, color: "var(--igy-on-dark-meta)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Admin</div>
        <nav className="admin-nav">
          {nav.length === 0 && !staff && <span style={{ fontSize: 13, color: "var(--igy-on-dark-meta)", padding: "8px 12px" }}>No sections available for this role.</span>}
          {nav.map((n) => {
            const c = pending[n.href] ?? 0;
            return (
              <Link key={n.href} href={n.href} className="admin-nav-item">
                <span>{n.label}</span>
                {c > 0 && (
                  <span className="nav-count" aria-label={`${c} item${c === 1 ? "" : "s"} need attention`}>{c}</span>
                )}
              </Link>
            );
          })}
          {/* Employee Manual is open to every staff member; its sections are individually role-gated on the page itself. */}
          {staff && <Link href="/admin/handbook">Employee Manual</Link>}
        </nav>
        <div style={{ marginTop: "auto", paddingTop: 24, fontSize: 12, color: "var(--igy-on-dark-meta)" }}>
          <div>Acting role</div>
          <div style={{ color: "var(--igy-admin-text)", fontWeight: 700 }}>{staff?.jobRole ?? "N/A"}</div>
        </div>
      </aside>
      <main className="admin-main">{children}</main>
    </div>
  );
}
