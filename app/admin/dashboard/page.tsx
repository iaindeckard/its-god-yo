import Link from "next/link";
import { can } from "@/lib/rbac";
import Forbidden from "@/components/Forbidden";
import { getDashboardMetrics, RANGES, type RangeKey } from "@/lib/dashboardMetrics";
import DashboardClient from "./DashboardClient";
import { usdFull } from "./charts/theme";

export const dynamic = "force-dynamic";

function parseRange(v: string | undefined): RangeKey {
  return v === "7d" || v === "90d" ? v : "30d";
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ range?: string; demo?: string }> }) {
  if (!(await can("analytics.dashboard.view"))) return <Forbidden permission="analytics.dashboard.view" />;
  const sp = await searchParams;
  const range = parseRange(sp.range);
  const demo = sp.demo === "1";
  const [m, canViewRevenue] = await Promise.all([getDashboardMetrics(range, { demo }), can("analytics.revenue.view")]);

  const qp = (r: RangeKey) => `?range=${r}${demo ? "&demo=1" : ""}`;

  return (
    <>
      <div className="admin-head">
        <h1>KPI dashboard</h1>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span className="dev-badge">first-pass — adjust widgets freely</span>
          <div className="range-toggle" role="group" aria-label="Time range">
            {RANGES.map((r) => (
              <Link key={r.key} href={qp(r.key)} className={`range-pill${range === r.key ? " on" : ""}`} scroll={false}>{r.label}</Link>
            ))}
          </div>
          <Link href={demo ? `?range=${range}` : `?range=${range}&demo=1`} scroll={false} className={`demo-pill${demo ? " on" : ""}`}>
            {demo ? "Demo data ✓" : "Demo data"}
          </Link>
        </div>
      </div>

      {demo ? (
        <div className="admin-note" style={{ background: "#fff6e6", borderColor: "#f0c674", color: "#8a5a00" }}>
          <strong>Demo data</strong> — illustrative figures generated in memory to preview the design. Nothing here is real or written to the database. Turn off &ldquo;Demo data&rdquo; to see live figures.
        </div>
      ) : (
        <p className="muted" style={{ marginTop: -12, marginBottom: 20 }}>
          Live figures from the real tables + Stripe. Most are legitimately near-zero today (delayed billing, near-empty
          tables at launch) — that&rsquo;s the accurate current picture, not placeholder data. Use{" "}
          <Link href={`?range=${range}&demo=1`} scroll={false}>Demo data</Link> to preview the design populated.
        </p>
      )}

      {m.stripeError && <div className="error">Stripe: {m.stripeError}</div>}

      <DashboardClient m={m} canViewRevenue={canViewRevenue} />

      {canViewRevenue && m.donationFund && (
        <div className="dash-grid" style={{ marginTop: "var(--space-4)" }}>
          <div className="dash-card span-4">
            <div className="dash-card-title">Reserved donation fund</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: "var(--igy-ink)", marginTop: 4 }}>{usdFull(m.donationFund.availableCents)}</div>
            <div className="dash-card-sub" style={{ marginTop: 4 }}>
              available to disburse · {usdFull(m.donationFund.accruedCents)} accrued − {usdFull(m.donationFund.disbursedCents)} donated
              {m.donationFund.lastCloseDate ? ` · last close ${m.donationFund.lastCloseDate}` : " · no close yet"} · <Link href="/admin/donation-fund">manage</Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
