import "server-only";
import { getSupabaseAdmin } from "./supabaseAdmin";
import { getStripe } from "./stripe";
import { computeRunway } from "./contentRunway";

/** Unresolved Tier-3 alerts (igy_alert_state.resolved=false) — active incidents. */
export interface Incident {
  alert_type: string;
  entity_key: string;
  last_message: string | null;
  fire_count: number;
  last_fired_at: string | null;
}

export async function getIncidents(): Promise<Incident[]> {
  try {
    const admin = getSupabaseAdmin();
    const { data } = await admin
      .from("igy_alert_state")
      .select("alert_type, entity_key, last_message, fire_count, last_fired_at")
      .eq("resolved", false)
      .order("last_fired_at", { ascending: false });
    return (data ?? []) as Incident[];
  } catch {
    return [];
  }
}

/** Lightweight at-a-glance status (NOT the KPI dashboard). Each figure degrades to
 *  null/0 on error so the landing page never blanks. */
export interface GlanceStats {
  awaitingSms: number;
  sendsToday: { delivered: number; failed: number; total: number };
  runwayMinDays: number | null;
  runwayMinTrack: string | null;
  mrrCents: number | null;
  activeSubs: number | null;
}

function todayUtcIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function getGlanceStats(): Promise<GlanceStats> {
  const admin = getSupabaseAdmin();
  const today = todayUtcIso();

  const [awaitingSms, sends, runway, stripe] = await Promise.all([
    Promise.resolve(admin.from("pending_signups").select("*", { count: "exact", head: true }).eq("status", "awaiting_confirmation"))
      .then((r) => r.count ?? 0).catch(() => 0),
    Promise.resolve(admin.from("daily_send_log").select("status").eq("send_local_date", today))
      .then((r) => (r.data ?? []) as { status: string | null }[]).catch(() => [] as { status: string | null }[]),
    computeRunway(admin, today).catch(() => []),
    activeMrr().catch(() => ({ mrrCents: null as number | null, activeSubs: null as number | null })),
  ]);

  let delivered = 0, failed = 0;
  for (const s of sends) {
    if (s.status && !["delivered", "sent", "queued"].includes(s.status)) failed++;
    else delivered++;
  }

  // Nearest-to-empty track (null runway = out of content = most urgent).
  let minDays: number | null = null, minTrack: string | null = null;
  for (const t of runway) {
    const d = t.runwayDays === null ? -1 : t.runwayDays;
    if (minDays === null || d < minDays) { minDays = d; minTrack = t.label; }
  }

  return {
    awaitingSms,
    sendsToday: { delivered, failed, total: delivered + failed },
    runwayMinDays: minDays === -1 ? null : minDays,
    runwayMinTrack: minTrack,
    mrrCents: stripe.mrrCents,
    activeSubs: stripe.activeSubs,
  };
}

/** Best-effort active-subscriber MRR (live Stripe). Kept minimal — the full
 *  breakdown lives in the KPI dashboard. */
async function activeMrr(): Promise<{ mrrCents: number | null; activeSubs: number | null }> {
  const stripe = getStripe();
  const subs = await stripe.subscriptions.list({ status: "active", limit: 100 });
  let mrr = 0;
  for (const sub of subs.data) {
    for (const item of sub.items.data) {
      const price = item.price;
      const amount = (price.unit_amount ?? 0) * (item.quantity ?? 1);
      if (price.recurring?.interval === "month") mrr += amount / (price.recurring.interval_count ?? 1);
      else if (price.recurring?.interval === "year") mrr += amount / (12 * (price.recurring.interval_count ?? 1));
    }
  }
  return { mrrCents: Math.round(mrr), activeSubs: subs.data.length };
}
