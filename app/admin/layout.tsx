import Link from "next/link";
import BubbleMark from "@/components/BubbleMark";
import Wordmark from "@/components/Wordmark";
import { getCurrentStaff, getEffectivePermissions } from "@/lib/rbac";

export const metadata = { title: "Admin — It's God, Yo!" };
export const dynamic = "force-dynamic"; // identity/permissions resolve per-request, never at build

const NAV = [
  { href: "/admin/promo-codes", label: "Promo Code Studio", need: "billing.promo_codes.view" },
  { href: "/admin/referrals", label: "Referrals", need: "billing.promo_codes.view" },
  { href: "/admin/review", label: "Review queue", need: "content.queue.view" },
  { href: "/admin/theme-tags", label: "Theme tags", need: "content.theme_tags.view" },
  { href: "/admin/dashboard", label: "KPI dashboard", need: "analytics.dashboard.view" },
  { href: "/admin/donation-fund", label: "Donation Fund", need: "finance.donation_fund.view" },
  { href: "/admin/bounty", label: "Error bounty", need: "finance.bounty.view" },
  { href: "/admin/sponsors", label: "Sponsors", need: "marketing.sponsors.view" },
  { href: "/admin/consent-thresholds", label: "Consent thresholds", need: "admin.consent_thresholds.manage" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const staff = await getCurrentStaff();
  const perms = staff ? await getEffectivePermissions(staff) : new Set<string>();
  const nav = NAV.filter((n) => perms.has(n.need));

  return (
    <div className="admin-shell">
      <aside className="admin-side">
        <Link href="/admin" className="brand" style={{ textDecoration: "none" }}>
          <BubbleMark variant="light" size={30} />
          <Wordmark tone="brass" />
        </Link>
        <div style={{ fontSize: 12, color: "var(--igy-on-dark-meta)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Admin</div>
        <nav className="admin-nav">
          {nav.length === 0 && <span style={{ fontSize: 13, color: "var(--igy-on-dark-meta)", padding: "8px 12px" }}>No sections available for this role.</span>}
          {nav.map((n) => (
            <Link key={n.href} href={n.href}>{n.label}</Link>
          ))}
        </nav>
        <div style={{ marginTop: "auto", paddingTop: 24, fontSize: 12, color: "var(--igy-on-dark-meta)" }}>
          <div>Acting role</div>
          <div style={{ color: "var(--igy-admin-text)", fontWeight: 700 }}>{staff?.jobRole ?? "—"}</div>
        </div>
      </aside>
      <main className="admin-main">{children}</main>
    </div>
  );
}
