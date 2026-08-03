import { getCurrentStaff, getEffectivePermissions } from "@/lib/rbac";
import { PARTS, HANDBOOK_UPDATED, type Entry, type Part } from "./content";
import HandbookView from "./HandbookView";

export const metadata = { title: "Employee Manual — It's God, Yo!" };
export const dynamic = "force-dynamic"; // identity/permissions resolve per-request, never at build

// Each admin-screen entry inherits the permission that gates the real screen it
// documents (via relatedRoute). Everything else — the whole rest of the manual —
// is open to every staff member. Mirrors USN's /admin/handbook role-gating, but
// resolved ONCE here on the server (getEffectivePermissions) rather than per-RPC
// on the client: the client view only ever receives the entries this viewer may
// see, so search / TOC / quick-jump all inherently respect the gating.
const ROUTE_PERMISSION: Record<string, string> = {
  "/admin/cornerstone": "partners.view",
  "/admin/preorder": "billing.preorder.launch",
  "/admin/review": "content.queue.view",
  "/admin/theme-tags": "content.theme_tags.view",
  "/admin/bounty": "finance.bounty.view",
  "/admin/promo-codes": "billing.promo_codes.view",
  "/admin/referrals": "billing.promo_codes.view",
  "/admin/dashboard": "analytics.dashboard.view",
  "/admin/donation-fund": "finance.donation_fund.view",
  "/admin/sponsors": "marketing.sponsors.view",
  "/admin/consent-thresholds": "admin.consent_thresholds.manage",
};

function requirementFor(entry: Entry): string | null {
  if (entry.relatedRoute && ROUTE_PERMISSION[entry.relatedRoute]) return ROUTE_PERMISSION[entry.relatedRoute];
  return null; // visible to any staff member
}

export default async function HandbookPage() {
  const staff = await getCurrentStaff();
  if (!staff) {
    return (
      <>
        <div className="admin-head"><h1>Employee Manual</h1></div>
        <p className="muted">The Employee Manual is available to It&rsquo;s God, Yo! staff members. Sign in with a staff account to view it.</p>
      </>
    );
  }

  const perms = await getEffectivePermissions(staff);
  const canSee = (entry: Entry) => {
    const req = requirementFor(entry);
    return req === null || perms.has(req);
  };

  const visibleParts: Part[] = PARTS
    .map((p) => ({ ...p, entries: p.entries.filter(canSee) }))
    .filter((p) => p.entries.length > 0);

  const total = PARTS.reduce((n, p) => n + p.entries.length, 0);
  const shown = visibleParts.reduce((n, p) => n + p.entries.length, 0);

  return (
    <HandbookView
      parts={visibleParts}
      hiddenCount={total - shown}
      updated={HANDBOOK_UPDATED}
      jobRole={staff.jobRole}
    />
  );
}
