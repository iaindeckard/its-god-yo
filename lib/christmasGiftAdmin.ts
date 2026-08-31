import "server-only";
import { getSupabaseAdmin } from "./supabaseAdmin";

/** Admin overview of the Christmas Scheduled Gift pipeline: counts by status and by the
 *  window that drove each sale, collected revenue per window, and a recent list. */
export interface ChristmasGiftRow {
  id: string;
  created_at: string;
  status: string;
  purchase_window: string;
  charged_amount_cents: number;
  recipient_first_name: string | null;
  release_at: string;
  dmfh_bonus_included: boolean;
}
export interface ChristmasGiftAdminOverview {
  total: number;
  byStatus: Record<string, number>;
  byWindow: Record<string, number>;
  collectedCentsByWindow: Record<string, number>;
  recent: ChristmasGiftRow[];
}

// Rows that never collected money (abandoned/failed pre-payment, or explicitly canceled)
// are excluded from the revenue tallies but still counted in byStatus.
const NON_REVENUE = new Set(["pending_payment", "canceled"]);

export async function getChristmasGiftAdminOverview(recentLimit = 100): Promise<ChristmasGiftAdminOverview> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("christmas_gift_2026_purchases")
    .select("id, created_at, status, purchase_window, charged_amount_cents, recipient_first_name, release_at, dmfh_bonus_included")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`christmas_admin_overview_failed: ${error.message}`);
  const rows = (data ?? []) as ChristmasGiftRow[];

  const byStatus: Record<string, number> = {};
  const byWindow: Record<string, number> = {};
  const collectedCentsByWindow: Record<string, number> = {};
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    byWindow[r.purchase_window] = (byWindow[r.purchase_window] ?? 0) + 1;
    if (!NON_REVENUE.has(r.status)) {
      collectedCentsByWindow[r.purchase_window] = (collectedCentsByWindow[r.purchase_window] ?? 0) + r.charged_amount_cents;
    }
  }
  return { total: rows.length, byStatus, byWindow, collectedCentsByWindow, recent: rows.slice(0, recentLimit) };
}
