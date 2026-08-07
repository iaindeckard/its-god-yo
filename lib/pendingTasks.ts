import "server-only";
import { getSupabaseAdmin } from "./supabaseAdmin";

/**
 * Tier 1 of the solo-operator task-notification system (LOCKED spec 2026-08-06):
 * ONE centralized "pending tasks" computation — a single aggregation across every
 * admin queue table — so the admin shell can badge exactly the nav items that need
 * attention. Deliberately centralized here (not re-invented per page) so it stays
 * consistent as new queues are added: to add a queue, append one entry to QUEUES.
 *
 * These are the routine-backlog items (Tier 1): safe to sit for days, no deadline
 * pressure. Time-sensitive items go to Tier 2 (email, lib/contentRunway) and true
 * emergencies to Tier 3 (SMS, lib/smsAlert) — this module is intentionally the
 * low-urgency channel and does no alerting, just counts.
 *
 * Each entry declares the permission that governs its admin screen (`need`) and the
 * nav href it badges (`navHref`, null for queues with no screen yet, e.g. outreach —
 * those still surface in the /admin "needs attention" summary). `count` runs a
 * head-only COUNT (no rows fetched) via the service-role client.
 */

export interface PendingQueue {
  key: string;
  label: string;
  need: string;
  navHref: string | null;
  count: (db: ReturnType<typeof getSupabaseAdmin>) => Promise<number>;
}

const headCount = async (
  db: ReturnType<typeof getSupabaseAdmin>,
  table: string,
  apply: (q: any) => any,
): Promise<number> => {
  const { count, error } = await apply(db.from(table).select("*", { count: "exact", head: true }));
  if (error) throw new Error(`${table}_count_failed: ${error.message}`);
  return count ?? 0;
};

export const QUEUES: PendingQueue[] = [
  {
    key: "review",
    label: "Review queue",
    need: "content.queue.view",
    navHref: "/admin/review",
    // A slot needing review on EITHER language (mirrors lib/reviewQueue.getReviewQueue).
    count: (db) => headCount(db, "daily_slots", (q) => q.or("status.eq.needs_review,status_es.eq.needs_review")),
  },
  {
    key: "theme_tags",
    label: "Theme tags",
    need: "content.theme_tags.view",
    navHref: "/admin/theme-tags",
    count: (db) => headCount(db, "verse_theme_tags", (q) => q.eq("status", "proposed")),
  },
  {
    key: "pronoun_review",
    label: "Pronoun corrections",
    need: "content.queue.view",
    navHref: "/admin/pronoun-review",
    count: (db) => headCount(db, "pronoun_correction_proposals", (q) => q.eq("status", "proposed")),
  },
  {
    key: "cornerstone",
    label: "Cornerstone Partners",
    need: "partners.view",
    navHref: "/admin/cornerstone",
    // Applications awaiting a review decision (submitted or under_review); the other
    // statuses are past the review gate (approved/awaiting_payment/active/declined/…).
    count: (db) => headCount(db, "cornerstone_applications", (q) => q.in("status", ["submitted", "under_review"])),
  },
  {
    key: "bounty",
    label: "Error bounty",
    need: "finance.bounty.view",
    navHref: "/admin/bounty",
    count: (db) => headCount(db, "igy_error_reports", (q) => q.eq("status", "pending")),
  },
  {
    key: "failed_billing",
    label: "Failed billing",
    need: "finance.action_items.view",
    // Resolved inline on the /admin landing page (no dedicated screen).
    navHref: null,
    count: (db) => headCount(db, "igy_action_items", (q) => q.eq("kind", "failed_billing").eq("status", "open")),
  },
  {
    key: "dispute_review",
    label: "Disputes to review",
    need: "finance.action_items.view",
    navHref: null,
    count: (db) => headCount(db, "igy_action_items", (q) => q.eq("kind", "dispute_review").eq("status", "open")),
  },
  {
    key: "outreach",
    label: "Outreach leads",
    // Outreach has no admin screen yet — it is included so the centralized count is
    // complete (per spec) and it surfaces in the /admin summary. When an outreach
    // admin page lands, set navHref + need and it badges automatically.
    need: "*outreach-no-screen*",
    navHref: null,
    count: (db) => headCount(db, "igy_outreach_leads", (q) => q.eq("status", "needs_review")),
  },
];

export interface PendingCount {
  key: string;
  label: string;
  need: string;
  navHref: string | null;
  count: number;
}

/**
 * Run every queue count in parallel. A single failing queue must not blank the
 * whole shell, so a failed count degrades to 0 and is logged (the admin still sees
 * the other badges). Returns one entry per queue.
 */
export async function getPendingTaskCounts(): Promise<PendingCount[]> {
  const db = getSupabaseAdmin();
  return Promise.all(
    QUEUES.map(async (qd) => {
      let count = 0;
      try {
        count = await qd.count(db);
      } catch (e) {
        console.error(`[pending-tasks] ${qd.key} count failed:`, e instanceof Error ? e.message : e);
      }
      return { key: qd.key, label: qd.label, need: qd.need, navHref: qd.navHref, count };
    }),
  );
}

/** Convenience: counts keyed by nav href, for the sidebar (only entries with a screen). */
export async function getPendingCountsByHref(): Promise<Record<string, number>> {
  const counts = await getPendingTaskCounts();
  const map: Record<string, number> = {};
  for (const c of counts) if (c.navHref && c.count > 0) map[c.navHref] = c.count;
  return map;
}
