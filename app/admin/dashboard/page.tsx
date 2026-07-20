import { can } from "@/lib/rbac";
import Forbidden from "@/components/Forbidden";
import { getDashboardData } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

const usd = (cents: number) => `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

export default async function DashboardPage() {
  if (!(await can("analytics.dashboard.view"))) return <Forbidden permission="analytics.dashboard.view" />;
  const d = await getDashboardData();

  return (
    <>
      <div className="admin-head">
        <h1>KPI dashboard</h1>
        <span className="dev-badge">first-pass — adjust widgets freely</span>
      </div>
      <p className="muted" style={{ marginTop: -12, marginBottom: 20 }}>
        Live figures from the real tables + Stripe. Most are legitimately near-zero today (delayed billing means no
        active subscriptions yet) — that&rsquo;s the accurate current picture, not placeholder data.
      </p>

      <div className="kpi-grid">
        {/* Active subscribers */}
        <div className="kpi k-span2">
          <div className="k-label">Active subscribers</div>
          <div className="k-value">{d.activeSubscribers.total}</div>
          {d.stripeError ? (
            <div className="k-sub" style={{ color: "#a12626" }}>Stripe: {d.stripeError}</div>
          ) : d.activeSubscribers.byTier.length ? (
            <ul className="breakdown">
              {d.activeSubscribers.byTier.map((t) => (
                <li key={t.label}><span>{t.label}</span><span>{t.count}</span></li>
              ))}
            </ul>
          ) : (
            <div className="k-sub">No active subscriptions yet.</div>
          )}
        </div>

        {/* MRR / ARR */}
        <div className="kpi">
          <div className="k-label">MRR (est.)</div>
          <div className="k-value">{usd(d.mrrCents)}</div>
          <div className="k-sub">from active Stripe subscriptions</div>
        </div>
        <div className="kpi">
          <div className="k-label">ARR (est.)</div>
          <div className="k-value">{usd(d.arrCents)}</div>
          <div className="k-sub">MRR × 12</div>
        </div>

        {/* Pending signups awaiting SMS */}
        <div className="kpi">
          <div className="k-label">Awaiting SMS confirmation</div>
          <div className="k-value">{d.pendingAwaitingConfirmation}</div>
          <div className="k-sub">pending_signups “stuck” on a reply</div>
        </div>

        {/* Review backlog */}
        <div className="kpi">
          <div className="k-label">Review backlog</div>
          <div className="k-value">{d.reviewBacklog.en + d.reviewBacklog.es}</div>
          <div className="k-sub">{d.reviewBacklog.en} EN · {d.reviewBacklog.es} ES flagged</div>
        </div>

        {/* Referral usage */}
        <div className="kpi">
          <div className="k-label">Referral redemptions</div>
          <div className="k-value">{d.referralRedemptions}</div>
          <div className="k-sub">signups w/ referral applied</div>
        </div>

        {/* Consent funnel */}
        <div className="kpi k-span2">
          <div className="k-label">Consent funnel</div>
          <ul className="breakdown" style={{ marginTop: 8 }}>
            {d.consentFunnel.map((f) => (
              <li key={f.status}><span>{f.status.replace(/_/g, " ")}</span><span>{f.count}</span></li>
            ))}
          </ul>
        </div>

        {/* Promo usage */}
        <div className="kpi k-span2">
          <div className="k-label">Promo code usage</div>
          {d.promoUsage.length === 0 ? (
            <div className="k-sub" style={{ marginTop: 8 }}>No promo codes.</div>
          ) : (
            <ul className="breakdown" style={{ marginTop: 8 }}>
              {d.promoUsage.map((p) => (
                <li key={p.code}>
                  <span className="mono">{p.code} {p.active ? "" : "(inactive)"}</span>
                  <span>{p.times_redeemed} redeemed</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
