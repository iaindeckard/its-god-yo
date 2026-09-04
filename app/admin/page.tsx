import Link from "next/link";
import { getCurrentStaff, getEffectivePermissions } from "@/lib/rbac";
import { getPendingTaskCounts } from "@/lib/pendingTasks";
import { getIncidents, getGlanceStats } from "@/lib/landing";
import { listOpenActionItems } from "@/lib/actionItems";
import { getReviewQueue } from "@/lib/reviewQueue";
import AttentionReview from "./AttentionReview";
import AttentionActionItems from "./AttentionActionItems";
import ActiveIncidents from "./ActiveIncidents";

export const dynamic = "force-dynamic";

// Quick-links (nav is demoted to the bottom; the sidebar remains the full nav).
const SECTIONS = [
  { href: "/admin/review", label: "Review queue", need: "content.queue.view" },
  { href: "/admin/dashboard", label: "KPI dashboard", need: "analytics.dashboard.view" },
  { href: "/admin/promo-codes", label: "Promo Studio", need: "billing.promo_codes.view" },
  { href: "/admin/cornerstone", label: "Cornerstone", need: "partners.view" },
  { href: "/admin/bounty", label: "Error bounty", need: "finance.bounty.view" },
  { href: "/admin/roles", label: "Roles & staff", need: "admin.roles.manage" },
  { href: "/admin/consent-thresholds", label: "Consent thresholds", need: "admin.consent_thresholds.manage" },
];

// Attention items, most-urgent first. Money/disputes and the send-gating review
// queue rank above the slower content/partner queues.
const PRIORITY = ["outreach_reply", "dispute_review", "failed_billing", "review", "cornerstone", "bounty", "pronoun_review", "theme_tags", "outreach"];

const usd = (cents: number | null) =>
  cents == null ? "—" : `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export default async function AdminHome() {
  const staff = await getCurrentStaff();
  const perms = staff ? await getEffectivePermissions(staff) : new Set<string>();
  const canView = (need: string) => (need === "*outreach-no-screen*" ? perms.has("admin.roles.manage") : perms.has(need));

  const canReviewView = perms.has("content.queue.view");
  const canFinance = perms.has("finance.action_items.view");
  const canOutreachReplies = perms.has("outreach.replies.view");

  const [pending, incidents, glance, actionItems, reviewSlots] = await Promise.all([
    staff ? getPendingTaskCounts().catch(() => []) : Promise.resolve([]),
    staff ? getIncidents().catch(() => []) : Promise.resolve([]),
    staff ? getGlanceStats().catch(() => null) : Promise.resolve(null),
    // Action items span kinds gated by different permissions; load if the operator
    // can see any of them, then filter per-kind at render.
    (canFinance || canOutreachReplies) ? listOpenActionItems().catch(() => []) : Promise.resolve([]),
    canReviewView ? getReviewQueue().catch(() => []) : Promise.resolve([]),
  ]);

  const byKey = new Map(pending.map((p) => [p.key, p]));
  const attention = PRIORITY.map((k) => byKey.get(k)).filter((p) => p && p.count > 0 && canView(p.need)) as NonNullable<ReturnType<typeof byKey.get>>[];

  const reviewApprove = perms.has("content.queue.approve");
  const reviewRejectVerse = perms.has("content.queue.reject_verse");
  const canRevenue = perms.has("analytics.revenue.view");

  return (
    <>
      <div className="admin-head">
        <h1>Admin</h1>
        <span className="role-badge">{staff?.jobRole ?? "no role"}</span>
      </div>

      {/* ---------- Active incidents (only when present) ---------- */}
      {incidents.length > 0 && (
        <ActiveIncidents incidents={incidents} canAck={perms.has("admin.roles.manage")} />
      )}

      {/* ---------- Needs your attention ---------- */}
      <div className="card attn-card">
        <div className="attn-card-head">Needs your attention</div>
        {attention.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Nothing needs action right now. 🎉</p>
        ) : (
          <div className="attn-list">
            {attention.map((p) => (
              <div key={p!.key} className="attn-row">
                <div className="attn-row-head">
                  <span className="attn-label">{p!.label}</span>
                  <span className="nav-count">{p!.count}</span>
                  {p!.navHref && <Link href={p!.navHref} className="attn-open">Open →</Link>}
                </div>
                {p!.key === "review" && (
                  <AttentionReview slots={reviewSlots.slice(0, 3)} totalCount={p!.count} perms={{ approve: reviewApprove, rejectVerse: reviewRejectVerse }} />
                )}
                {(p!.key === "failed_billing" || p!.key === "dispute_review" || p!.key === "outreach_reply") && (
                  <AttentionActionItems items={actionItems.filter((a) => a.kind === p!.key)} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---------- At a glance (status, not charts) ---------- */}
      {glance && (
        <div className="glance">
          <Glance label="Awaiting SMS reply" value={`${glance.awaitingSms}`} href="/admin/dashboard" />
          <Glance label="Sends today" value={<span>{glance.sendsToday.delivered} ✓{glance.sendsToday.failed > 0 ? <span style={{ color: "var(--igy-error-text)" }}> · {glance.sendsToday.failed} ✗</span> : " · 0 ✗"}</span>} href="/admin/dashboard" />
          <Glance label="Content runway" value={glance.runwayMinTrack ? (glance.runwayMinDays == null ? `${glance.runwayMinTrack}: empty` : `${glance.runwayMinTrack}: ${glance.runwayMinDays}d`) : "—"} href="/admin/dashboard" tone={glance.runwayMinDays != null && glance.runwayMinDays < 7 ? "warn" : undefined} />
          {canRevenue && <Glance label="MRR" value={usd(glance.mrrCents)} sub={glance.activeSubs != null ? `${glance.activeSubs} active` : undefined} href="/admin/dashboard" />}
        </div>
      )}

      {/* ---------- Quick links (nav, de-emphasized) ---------- */}
      <div className="quick-links">
        {SECTIONS.filter((s) => perms.has(s.need)).map((s) => (
          <Link key={s.href} href={s.href} className="quick-link">{s.label}</Link>
        ))}
        {[...perms].length === 0 && <p className="muted">This account has no admin sections enabled.</p>}
      </div>
    </>
  );
}

function Glance({ label, value, sub, href, tone }: { label: string; value: React.ReactNode; sub?: string; href: string; tone?: "warn" }) {
  return (
    <Link href={href} className={`glance-tile${tone === "warn" ? " warn" : ""}`}>
      <div className="glance-label">{label}</div>
      <div className="glance-value">{value}</div>
      {sub && <div className="glance-sub">{sub}</div>}
    </Link>
  );
}
