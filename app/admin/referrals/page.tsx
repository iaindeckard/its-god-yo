import { can } from "@/lib/rbac";
import Forbidden from "@/components/Forbidden";
import { getReferralAdminOverview } from "@/lib/referral";

export const dynamic = "force-dynamic";

// Referrals are a billing-adjacent surface; gated behind the same permission as
// Promo Code Studio rather than adding a new RBAC permission for now.
const NEED = "billing.promo_codes.view";

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
function shortId(id: string | null): string {
  if (!id) return "N/A";
  return id.length > 16 ? `${id.slice(0, 15)}…` : id;
}

export default async function ReferralsAdminPage() {
  if (!(await can(NEED))) return <Forbidden permission={NEED} />;
  const o = await getReferralAdminOverview();

  const tiles = [
    { label: "Total referrals", value: String(o.totalEvents) },
    { label: "Rewarded", value: String(o.statusCounts.rewarded ?? 0) },
    { label: "Pending / converted", value: String((o.statusCounts.pending ?? 0) + (o.statusCounts.converted ?? 0)) },
    { label: "Capped", value: String(o.statusCounts.capped ?? 0) },
    { label: "Voided (clawed back)", value: String(o.statusCounts.void ?? 0) },
    { label: "Net reward credit", value: money(o.netRewardCents) },
  ];

  const cell: React.CSSProperties = { padding: "8px 12px", borderBottom: "1px solid var(--igy-line)", textAlign: "left", fontSize: 14 };

  return (
    <>
      <div className="admin-head">
        <h1>Referrals</h1>
      </div>
      <div className="admin-note">
        Give-a-month / get-a-month referral loop. Rewards are Stripe customer-balance credits, granted on the
        referee&rsquo;s first paid invoice and capped at 6 per referrer per rolling 12 months. Read-only.{" "}
        {o.rewardsGranted} grant(s), {o.rewardsReversed} reversal(s) to date.
      </div>

      <div className="grid cols-3">
        {tiles.map((t) => (
          <div key={t.label} className="card">
            <div className="muted" style={{ fontSize: 13 }}>{t.label}</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{t.value}</div>
          </div>
        ))}
      </div>

      <h2 style={{ marginTop: 24, fontSize: 16 }}>Recent referrals</h2>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={cell}>Created</th>
              <th style={cell}>Status</th>
              <th style={cell}>Referrer</th>
              <th style={cell}>Referee</th>
              <th style={cell}>Rewarded</th>
            </tr>
          </thead>
          <tbody>
            {o.recent.length === 0 && (
              <tr><td style={cell} colSpan={5}><span className="muted">No referrals yet.</span></td></tr>
            )}
            {o.recent.map((r) => (
              <tr key={r.id}>
                <td style={cell}>{new Date(r.created_at).toLocaleDateString()}</td>
                <td style={cell}>{r.status}</td>
                <td style={{ ...cell, fontFamily: "var(--font-mono, monospace)" }}>{shortId(r.referrer)}</td>
                <td style={{ ...cell, fontFamily: "var(--font-mono, monospace)" }}>{shortId(r.referee)}</td>
                <td style={cell}>{r.rewardedAt ? new Date(r.rewardedAt).toLocaleDateString() : "N/A"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
