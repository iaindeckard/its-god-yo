import { can } from "@/lib/rbac";
import Forbidden from "@/components/Forbidden";
import { getChristmasGiftAdminOverview } from "@/lib/christmasGiftAdmin";

export const dynamic = "force-dynamic";

// Christmas gift pipeline is a billing/revenue surface; gated behind the same permission
// as the Promo Code Studio / Referrals rather than adding a new RBAC permission.
const NEED = "billing.promo_codes.view";

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
const WINDOWS = ["early_bird", "flash_sale", "standard"] as const;
const STATUSES = ["pending_payment", "awaiting_release", "confirmation_sent", "confirmed", "credited", "canceled"] as const;
const windowLabel: Record<string, string> = { early_bird: "Early bird", flash_sale: "Black Friday", standard: "Standard" };

export default async function ChristmasGiftsAdminPage() {
  if (!(await can(NEED))) return <Forbidden permission={NEED} />;
  const o = await getChristmasGiftAdminOverview();

  const cell: React.CSSProperties = { padding: "8px 12px", borderBottom: "1px solid var(--igy-line)", textAlign: "left", fontSize: 14 };
  const th: React.CSSProperties = { ...cell, fontWeight: 600 };

  return (
    <>
      <div className="admin-head">
        <h1>Christmas Scheduled Gifts</h1>
      </div>
      <div className="admin-note">
        Prepaid one-year gift purchases. Revenue tallies exclude pending_payment and canceled rows (no money collected).
      </div>

      <h3 style={{ marginTop: 16 }}>By status</h3>
      <table style={{ borderCollapse: "collapse", width: "100%", maxWidth: 640 }}>
        <thead><tr><th style={th}>Status</th><th style={th}>Count</th></tr></thead>
        <tbody>
          {STATUSES.map((s) => (
            <tr key={s}><td style={cell}>{s}</td><td style={cell}>{o.byStatus[s] ?? 0}</td></tr>
          ))}
          <tr><td style={{ ...cell, fontWeight: 600 }}>Total</td><td style={{ ...cell, fontWeight: 600 }}>{o.total}</td></tr>
        </tbody>
      </table>

      <h3 style={{ marginTop: 20 }}>By purchase window</h3>
      <table style={{ borderCollapse: "collapse", width: "100%", maxWidth: 640 }}>
        <thead><tr><th style={th}>Window</th><th style={th}>Purchases</th><th style={th}>Collected</th></tr></thead>
        <tbody>
          {WINDOWS.map((w) => (
            <tr key={w}>
              <td style={cell}>{windowLabel[w]}</td>
              <td style={cell}>{o.byWindow[w] ?? 0}</td>
              <td style={cell}>{money(o.collectedCentsByWindow[w] ?? 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 style={{ marginTop: 20 }}>Recent purchases</h3>
      {o.recent.length === 0 ? (
        <p className="muted">No purchases yet.</p>
      ) : (
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={th}>Created</th><th style={th}>Status</th><th style={th}>Window</th>
              <th style={th}>Recipient</th><th style={th}>Release</th><th style={th}>Charged</th><th style={th}>DMFH</th>
            </tr>
          </thead>
          <tbody>
            {o.recent.map((r) => (
              <tr key={r.id}>
                <td style={cell}>{new Date(r.created_at).toLocaleDateString()}</td>
                <td style={cell}>{r.status}</td>
                <td style={cell}>{windowLabel[r.purchase_window] ?? r.purchase_window}</td>
                <td style={cell}>{r.recipient_first_name ?? "N/A"}</td>
                <td style={cell}>{r.release_at}</td>
                <td style={cell}>{money(r.charged_amount_cents)}</td>
                <td style={cell}>{r.dmfh_bonus_included ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
