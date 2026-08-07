import "server-only";
import { getSupabaseAdmin } from "./supabaseAdmin";
import { getStripe } from "./stripe";
import { PLANS, GROUP_BANDS, DM_ADDON } from "./plans";
import { computeRunway } from "./contentRunway";

/**
 * KPI dashboard metrics — the data layer behind the charted redesign.
 *
 * Two sources, one shape (DashboardMetrics):
 *  - REAL: aggregated from the live tables + Stripe, range-bounded, bucketed
 *    server-side (in TS rather than in-DB, to avoid a schema migration for a
 *    read-only view given today's tiny row counts — trivially movable to SQL
 *    views/RPCs later if volume grows).
 *  - DEMO: a deterministic in-memory generator (NEVER written to the DB), gated
 *    behind ?demo=1 for super-admins. IGY is at launch so the real tables are
 *    near-empty; demo mode lets the operator preview the full visual design and
 *    is what the design screenshots exercise. Always banner-labeled in the UI.
 */

export type RangeKey = "7d" | "30d" | "90d";
export const RANGES: { key: RangeKey; label: string; days: number }[] = [
  { key: "7d", label: "7 days", days: 7 },
  { key: "30d", label: "30 days", days: 30 },
  { key: "90d", label: "90 days", days: 90 },
];
export function rangeDays(r: RangeKey): number {
  return RANGES.find((x) => x.key === r)?.days ?? 30;
}

export interface RevenuePoint {
  date: string; // bucket start ISO date (YYYY-MM-DD)
  label: string; // short display label
  grossCents: number;
  netCents: number;
  refundCents: number;
  feeCents: number;
}
export interface MrrPoint {
  date: string;
  label: string;
  mrrCents: number;
  arrCents: number;
  activeSubs: number;
}
export interface SignupPoint {
  date: string;
  label: string;
  signups: number;
}
export interface ChurnPoint {
  date: string;
  label: string;
  added: number;
  churned: number; // stored negative for the diverging bar
  net: number;
}
export interface DeliveryDay {
  date: string;
  label: string;
  delivered: number;
  failed: number;
  total: number;
}
export interface HeatCell {
  day: number; // 0=Sun..6=Sat
  hour: number; // 0..23
  total: number;
  failed: number;
}
export interface SpendPoint {
  date: string;
  label: string;
  cents: number;
  segments: number;
}
export interface SourceSlice {
  source: string;
  label: string;
  signups: number;
  netCents: number;
}
export interface CountSlice {
  key: string;
  label: string;
  count: number;
}
export interface FunnelStage {
  key: string;
  label: string;
  count: number;
}
export interface RunwaySlice {
  track: string;
  label: string;
  runwayDays: number | null;
  furthest: string | null;
}

/** Per-promo-code performance + its impact on the recurring-revenue metrics. */
export interface PromoPerf {
  code: string;
  label: string | null;
  active: boolean;
  redemptions: number; // Stripe times_redeemed
  signups: number; // signups that applied this code
  conversions: number; // of those, that reached an active subscription
  grossCents: number; // gross billed on those subscriptions (in range-to-date)
  netCents: number; // settled net after fees/refunds
  discountCents: number; // discount value given away
  mrrCents: number; // recurring monthly contribution from this code's cohort
  arpuCents: number; // net / conversions (0 if none)
  discountPct: number | null; // headline depth for context
}

export interface DrillPlanSource {
  plan: CountSlice[];
  source: CountSlice[];
}

export interface DashboardMetrics {
  range: RangeKey;
  demo: boolean;
  generatedAt: string;
  stripeError: string | null;

  // Headline snapshots (the "at a glance" strip) + a tiny sparkline series each.
  headline: {
    mrrCents: number;
    arrCents: number;
    activeSubs: number;
    arpuCents: number;
    netRevenueCents: number; // over the selected range
    newSignups: number; // over the range
    churnRatePct: number | null;
    deliveryRatePct: number | null;
  };
  spark: {
    mrr: number[];
    revenue: number[];
    signups: number[];
    churn: number[];
    delivery: number[];
  };

  revenueTrend: RevenuePoint[];
  revenueDrill: Record<string, DrillPlanSource>; // keyed by RevenuePoint.date
  mrrTrend: MrrPoint[];
  signups: SignupPoint[];
  acquisition: SourceSlice[];
  funnel: FunnelStage[];
  planMix: CountSlice[];
  themeMix: CountSlice[];
  churn: ChurnPoint[];
  delivery: DeliveryDay[];
  deliveryHeat: HeatCell[];
  smsSpend: SpendPoint[];
  contentRunway: RunwaySlice[];

  promoPerf: PromoPerf[];
  promoUsage: { code: string; times_redeemed: number; active: boolean }[];

  // Reserved donation fund (financial — only surfaced behind analytics.revenue.view).
  donationFund: { availableCents: number; accruedCents: number; disbursedCents: number; lastCloseDate: string | null } | null;
}

// ---------------------------------------------------------------------------
// Bucketing helpers (shared by real + demo).
// ---------------------------------------------------------------------------

interface Bucket {
  start: Date;
  date: string;
  label: string;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function shortLabel(d: Date, weekly: boolean): string {
  const mo = d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  const day = d.getUTCDate();
  return weekly ? `${mo} ${day}` : `${mo} ${day}`;
}

/** Build the ordered list of time buckets for a range: daily for 7/30, weekly for 90. */
function buildBuckets(range: RangeKey, now: Date): { buckets: Bucket[]; weekly: boolean; startMs: number } {
  const days = rangeDays(range);
  const weekly = days > 30;
  const step = weekly ? 7 : 1;
  const count = Math.ceil(days / step);
  const buckets: Bucket[] = [];
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const startMs = end.getTime() - (count - 1) * step * 86_400_000;
  for (let i = 0; i < count; i++) {
    const start = new Date(startMs + i * step * 86_400_000);
    buckets.push({ start, date: isoDate(start), label: shortLabel(start, weekly) });
  }
  return { buckets, weekly, startMs };
}

/** Index a timestamp into a bucket position (or -1 if before the window). */
function bucketIndex(tsMs: number, startMs: number, weekly: boolean, len: number): number {
  const step = (weekly ? 7 : 1) * 86_400_000;
  const idx = Math.floor((tsMs - startMs) / step);
  return idx >= 0 && idx < len ? idx : -1;
}

// ---------------------------------------------------------------------------
// Entry point.
// ---------------------------------------------------------------------------

export async function getDashboardMetrics(range: RangeKey, opts: { demo: boolean }): Promise<DashboardMetrics> {
  if (opts.demo) return demoMetrics(range);
  return realMetrics(range);
}

// ---------------------------------------------------------------------------
// REAL aggregation.
// ---------------------------------------------------------------------------

function priceLabelMap(): Record<string, string> {
  const m: Record<string, string> = {};
  if (PLANS.individual_monthly.price_id) m[PLANS.individual_monthly.price_id] = "Individual (monthly)";
  if (PLANS.individual_annual.price_id) m[PLANS.individual_annual.price_id] = "Individual (annual)";
  if (PLANS.family_annual.price_id) m[PLANS.family_annual.price_id] = "Family";
  if (PLANS.gift_annual.price_id) m[PLANS.gift_annual.price_id] = "Gift";
  for (const b of GROUP_BANDS) m[b.price_id] = `Group ${b.min}-${b.max}`;
  m[DM_ADDON.price_id] = "DM from Him add-on";
  return m;
}

const SOURCE_LABELS: Record<string, string> = {
  promo: "Promo code",
  referral: "Referral",
  cornerstone: "Cornerstone church",
  enrollment: "Church enrollment link",
  organic: "Organic",
};

function planLabel(key: string | null): string {
  if (!key) return "Unknown";
  const map: Record<string, string> = {
    individual_monthly: "Individual (monthly)",
    individual_annual: "Individual (annual)",
    family: "Family",
    family_annual: "Family",
    gift_annual: "Gift",
  };
  if (map[key]) return map[key];
  if (key.startsWith("group")) return "Group";
  return key;
}

async function realMetrics(range: RangeKey): Promise<DashboardMetrics> {
  const admin = getSupabaseAdmin();
  const now = new Date();
  const { buckets, weekly, startMs } = buildBuckets(range, now);
  const sinceIso = new Date(startMs).toISOString();
  const len = buckets.length;

  // --- Revenue trend (livemode only — real money) ---
  const revenueTrend: RevenuePoint[] = buckets.map((b) => ({ date: b.date, label: b.label, grossCents: 0, netCents: 0, refundCents: 0, feeCents: 0 }));
  const revenueDrill: Record<string, DrillPlanSource> = {};
  try {
    const { data: pays } = await admin
      .from("subscription_payments")
      .select("kind, settled_net_cents, settled_amount_cents, settled_fee_cents, stripe_created_at, livemode")
      .eq("livemode", true)
      .gte("stripe_created_at", sinceIso);
    for (const p of pays ?? []) {
      const idx = bucketIndex(Date.parse(p.stripe_created_at as string), startMs, weekly, len);
      if (idx < 0) continue;
      const sign = p.kind === "refund" || p.kind === "dispute" ? -1 : 1;
      revenueTrend[idx].grossCents += sign * (p.settled_amount_cents ?? 0);
      revenueTrend[idx].netCents += sign * (p.settled_net_cents ?? 0);
      revenueTrend[idx].feeCents += p.settled_fee_cents ?? 0;
      if (sign < 0) revenueTrend[idx].refundCents += p.settled_amount_cents ?? 0;
    }
  } catch { /* leave zeros */ }

  // --- Live Stripe: active subs, MRR, promo usage ---
  const stripe0 = await gatherStripe();

  // --- Signups over time + acquisition + plan/theme mix + funnel (pending_signups) ---
  const signups: SignupPoint[] = buckets.map((b) => ({ date: b.date, label: b.label, signups: 0 }));
  const acqMap: Record<string, SourceSlice> = {};
  const planMap: Record<string, CountSlice> = {};
  const themeMap: Record<string, CountSlice> = {};
  let funnelSignups = 0, funnelSub = 0;
  try {
    const { data: ps } = await admin
      .from("pending_signups")
      .select("created_at, promo_code, referral_code, cornerstone_partner_id, enrollment_link_id, plan_key, theme_track, stripe_subscription_id")
      .gte("created_at", sinceIso);
    for (const s of ps ?? []) {
      funnelSignups++;
      if (s.stripe_subscription_id) funnelSub++;
      const idx = bucketIndex(Date.parse(s.created_at as string), startMs, weekly, len);
      if (idx >= 0) signups[idx].signups++;
      const src = s.cornerstone_partner_id ? "cornerstone" : s.enrollment_link_id ? "enrollment" : s.promo_code ? "promo" : s.referral_code ? "referral" : "organic";
      (acqMap[src] ??= { source: src, label: SOURCE_LABELS[src], signups: 0, netCents: 0 }).signups++;
      const pl = planLabel(s.plan_key as string | null);
      (planMap[pl] ??= { key: pl, label: pl, count: 0 }).count++;
      const tt = (s.theme_track as string | null) || "general";
      (themeMap[tt] ??= { key: tt, label: tt, count: 0 }).count++;
    }
  } catch { /* empty */ }

  // --- Consent funnel + churn (consent_log) ---
  const churn: ChurnPoint[] = buckets.map((b, i) => ({ date: b.date, label: b.label, added: signups[i].signups, churned: 0, net: signups[i].signups }));
  let confirmed = 0, optedOut = 0, confirmationsSent = 0;
  try {
    const { data: cl } = await admin
      .from("consent_log")
      .select("consent_status, confirmation_sent_at, opted_out_at, created_at")
      .gte("created_at", sinceIso);
    for (const c of cl ?? []) {
      if (c.confirmation_sent_at) confirmationsSent++;
      if (c.consent_status === "confirmed") confirmed++;
      if (c.opted_out_at) {
        optedOut++;
        const idx = bucketIndex(Date.parse(c.opted_out_at as string), startMs, weekly, len);
        if (idx >= 0) { churn[idx].churned -= 1; churn[idx].net -= 1; }
      }
    }
  } catch { /* empty */ }

  // --- Delivery health + heatmap (daily_send_log) ---
  const delivery: DeliveryDay[] = buckets.map((b) => ({ date: b.date, label: b.label, delivered: 0, failed: 0, total: 0 }));
  const heat: Record<string, HeatCell> = {};
  try {
    const { data: dl } = await admin
      .from("daily_send_log")
      .select("status, send_local_date, created_at")
      .gte("send_local_date", isoDate(new Date(startMs)));
    for (const d of dl ?? []) {
      const idx = bucketIndex(Date.parse(`${d.send_local_date}T00:00:00Z`), startMs, weekly, len);
      const failed = d.status && !["delivered", "sent", "queued"].includes(d.status as string);
      if (idx >= 0) {
        delivery[idx].total++;
        if (failed) delivery[idx].failed++; else delivery[idx].delivered++;
      }
      const ts = new Date(d.created_at as string);
      const k = `${ts.getUTCDay()}-${ts.getUTCHours()}`;
      const cell = (heat[k] ??= { day: ts.getUTCDay(), hour: ts.getUTCHours(), total: 0, failed: 0 });
      cell.total++;
      if (failed) cell.failed++;
    }
  } catch { /* empty */ }

  // --- SMS spend (igy_sms_log) ---
  const smsSpend: SpendPoint[] = buckets.map((b) => ({ date: b.date, label: b.label, cents: 0, segments: 0 }));
  try {
    const { data: sms } = await admin
      .from("igy_sms_log")
      .select("cost_cents, segments, sent_on")
      .gte("sent_on", isoDate(new Date(startMs)));
    for (const s of sms ?? []) {
      const idx = bucketIndex(Date.parse(`${s.sent_on}T00:00:00Z`), startMs, weekly, len);
      if (idx >= 0) { smsSpend[idx].cents += Number(s.cost_cents ?? 0); smsSpend[idx].segments += s.segments ?? 0; }
    }
  } catch { /* empty */ }

  // --- Content runway ---
  let contentRunway: RunwaySlice[] = [];
  try {
    const rw = await computeRunway(admin, isoDate(now));
    contentRunway = rw.map((t) => ({ track: t.track, label: t.label, runwayDays: t.runwayDays, furthest: t.furthestApproved }));
  } catch { /* empty */ }

  // --- Promo performance (real): redemptions from Stripe, signups from pending_signups ---
  const promoPerf: PromoPerf[] = stripe0.promoViews.map((v) => ({
    code: v.code,
    label: v.label,
    active: v.active,
    redemptions: v.times_redeemed,
    signups: 0,
    conversions: 0,
    grossCents: 0,
    netCents: 0,
    discountCents: 0,
    mrrCents: 0,
    arpuCents: 0,
    discountPct: v.percent_off,
  }));

  // Donation fund (best-effort).
  let donationFund: DashboardMetrics["donationFund"] = null;
  try {
    const { getFundSummary } = await import("./donationFund");
    const f = await getFundSummary();
    donationFund = { availableCents: f.availableCents, accruedCents: f.accruedCents, disbursedCents: f.disbursedCents, lastCloseDate: f.lastCloseDate };
  } catch { donationFund = null; }

  const netRevenueCents = revenueTrend.reduce((a, b) => a + b.netCents, 0);
  const newSignups = signups.reduce((a, b) => a + b.signups, 0);
  const arpuCents = stripe0.activeSubscribers.total > 0 ? Math.round(stripe0.mrrCents / stripe0.activeSubscribers.total) : 0;
  const churnRatePct = stripe0.activeSubscribers.total + optedOut > 0 ? (optedOut / (stripe0.activeSubscribers.total + optedOut)) * 100 : null;
  const totalSends = delivery.reduce((a, b) => a + b.total, 0);
  const totalDelivered = delivery.reduce((a, b) => a + b.delivered, 0);
  const deliveryRatePct = totalSends > 0 ? (totalDelivered / totalSends) * 100 : null;

  const mrrTrend: MrrPoint[] = buckets.map((b) => ({ date: b.date, label: b.label, mrrCents: stripe0.mrrCents, arrCents: stripe0.mrrCents * 12, activeSubs: stripe0.activeSubscribers.total }));

  return {
    range,
    demo: false,
    generatedAt: now.toISOString(),
    stripeError: stripe0.error,
    headline: {
      mrrCents: stripe0.mrrCents,
      arrCents: stripe0.mrrCents * 12,
      activeSubs: stripe0.activeSubscribers.total,
      arpuCents,
      netRevenueCents,
      newSignups,
      churnRatePct,
      deliveryRatePct,
    },
    spark: {
      mrr: mrrTrend.map((m) => m.mrrCents),
      revenue: revenueTrend.map((r) => r.netCents),
      signups: signups.map((s) => s.signups),
      churn: churn.map((c) => -c.churned),
      delivery: delivery.map((d) => (d.total ? (d.delivered / d.total) * 100 : 0)),
    },
    revenueTrend,
    revenueDrill,
    mrrTrend,
    signups,
    acquisition: Object.values(acqMap).sort((a, b) => b.signups - a.signups),
    funnel: [
      { key: "signups", label: "Started signup", count: funnelSignups },
      { key: "sent", label: "SMS sent", count: confirmationsSent },
      { key: "confirmed", label: "Confirmed (YES)", count: confirmed },
      { key: "subscribed", label: "Subscription created", count: funnelSub },
      { key: "active", label: "Active now", count: stripe0.activeSubscribers.total },
    ],
    planMix: Object.values(planMap).sort((a, b) => b.count - a.count),
    themeMix: Object.values(themeMap).sort((a, b) => b.count - a.count),
    churn,
    delivery,
    deliveryHeat: Object.values(heat),
    smsSpend,
    contentRunway,
    promoPerf,
    promoUsage: stripe0.promoUsage,
    donationFund,
  };
}

async function gatherStripe(): Promise<{
  activeSubscribers: { total: number; byTier: CountSlice[] };
  mrrCents: number;
  promoUsage: { code: string; times_redeemed: number; active: boolean }[];
  promoViews: { code: string; label: string | null; times_redeemed: number; active: boolean; percent_off: number | null }[];
  error: string | null;
}> {
  try {
    const stripe = getStripe();
    const labels = priceLabelMap();
    const subs = await stripe.subscriptions.list({ status: "active", limit: 100 });
    let mrrCents = 0;
    const byTier: Record<string, number> = {};
    for (const sub of subs.data) {
      for (const item of sub.items.data) {
        const price = item.price;
        const qty = item.quantity ?? 1;
        const amount = (price.unit_amount ?? 0) * qty;
        if (price.recurring?.interval === "month") mrrCents += amount / (price.recurring.interval_count ?? 1);
        else if (price.recurring?.interval === "year") mrrCents += amount / (12 * (price.recurring.interval_count ?? 1));
        const label = labels[price.id] ?? price.nickname ?? price.id;
        byTier[label] = (byTier[label] ?? 0) + qty;
      }
    }
    const promos = await stripe.promotionCodes.list({ limit: 100 });
    return {
      activeSubscribers: { total: subs.data.length, byTier: Object.entries(byTier).map(([label, count]) => ({ key: label, label, count })) },
      mrrCents: Math.round(mrrCents),
      promoUsage: promos.data.map((p) => ({ code: p.code, times_redeemed: p.times_redeemed, active: p.active })),
      promoViews: promos.data.map((p) => ({ code: p.code, label: (p.metadata?.internal_label as string) || null, times_redeemed: p.times_redeemed, active: p.active, percent_off: p.coupon.percent_off ?? null })),
      error: null,
    };
  } catch (e) {
    return { activeSubscribers: { total: 0, byTier: [] }, mrrCents: 0, promoUsage: [], promoViews: [], error: e instanceof Error ? e.message : "stripe_error" };
  }
}

// ---------------------------------------------------------------------------
// DEMO generator — deterministic, in-memory only. Never touches the DB.
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function demoMetrics(range: RangeKey): DashboardMetrics {
  // Fixed seed → stable output (stable screenshots, no render flicker). We do not
  // use Date.now()/Math.random for the shape; the trailing edge is "today" only
  // for axis labels, taken from a single new Date() read.
  const rnd = mulberry32(0xC0FFEE + rangeDays(range));
  const now = new Date();
  const { buckets, weekly, startMs } = buildBuckets(range, now);
  void startMs;
  const n = buckets.length;

  // A gently-growing base with weekly seasonality and noise.
  const growth = (i: number, base: number, slope: number, wobble: number) =>
    Math.max(0, Math.round(base + slope * i + (rnd() - 0.4) * wobble + Math.sin(i / 2) * wobble * 0.3));

  const scale = weekly ? 7 : 1; // weekly buckets aggregate ~7x volume

  const signups: SignupPoint[] = buckets.map((b, i) => ({ date: b.date, label: b.label, signups: growth(i, 3 * scale, 0.6 * scale, 4 * scale) }));
  const revenueTrend: RevenuePoint[] = buckets.map((b, i) => {
    const gross = growth(i, 4000 * scale, 900 * scale, 3000 * scale);
    const refund = i % 5 === 0 ? Math.round(gross * (0.03 + rnd() * 0.05)) : 0;
    const fee = Math.round(gross * 0.029 + 30 * scale);
    return { date: b.date, label: b.label, grossCents: gross, netCents: gross - refund - fee, refundCents: refund, feeCents: fee };
  });

  // Drill-down: each revenue bucket splits into plan + source mix.
  const planNames = ["Individual (annual)", "Individual (monthly)", "Family", "Gift", "Group"];
  const srcNames: [string, string][] = [["organic", "Organic"], ["promo", "Promo code"], ["referral", "Referral"], ["cornerstone", "Cornerstone church"], ["enrollment", "Church enrollment link"]];
  const revenueDrill: Record<string, DrillPlanSource> = {};
  for (const r of revenueTrend) {
    const split = (names: string[] | [string, string][], total: number) => {
      const raw = names.map(() => rnd() + 0.2);
      const sum = raw.reduce((a, b) => a + b, 0);
      return names.map((nm, i) => {
        const label = Array.isArray(nm) ? nm[1] : (nm as string);
        const key = Array.isArray(nm) ? nm[0] : (nm as string);
        return { key, label, count: Math.round((raw[i] / sum) * total) };
      });
    };
    revenueDrill[r.date] = {
      plan: split(planNames, Math.max(1, Math.round(r.grossCents / 5000))),
      source: split(srcNames, Math.max(1, Math.round(r.grossCents / 5000))),
    };
  }

  const startSubs = 40 + Math.round(rnd() * 20);
  let subs = startSubs;
  const mrrTrend: MrrPoint[] = buckets.map((b, i) => {
    subs += Math.round((signups[i].signups * 0.5) - (rnd() * 2 * scale));
    subs = Math.max(20, subs);
    const mrr = subs * (450 + Math.round(rnd() * 120)); // ~$4.50-5.70 blended
    return { date: b.date, label: b.label, mrrCents: mrr, arrCents: mrr * 12, activeSubs: subs };
  });
  const activeSubs = mrrTrend[n - 1].activeSubs;
  const mrrCents = mrrTrend[n - 1].mrrCents;

  const churn: ChurnPoint[] = buckets.map((b, i) => {
    const added = signups[i].signups;
    const churned = -Math.round(rnd() * 3 * scale);
    return { date: b.date, label: b.label, added, churned, net: added + churned };
  });

  const delivery: DeliveryDay[] = buckets.map((b) => {
    const total = activeSubs + Math.round((rnd() - 0.5) * 6);
    const failed = Math.round(total * (0.005 + rnd() * 0.03));
    return { date: b.date, label: b.label, delivered: total - failed, failed, total };
  });

  // Heatmap: send volume by weekday × hour, concentrated around common send times.
  const deliveryHeat: HeatCell[] = [];
  for (let day = 0; day < 7; day++) {
    for (let hour = 6; hour <= 21; hour++) {
      const peak = Math.exp(-Math.pow(hour - 8, 2) / 8) + 0.6 * Math.exp(-Math.pow(hour - 12, 2) / 6) + 0.5 * Math.exp(-Math.pow(hour - 18, 2) / 6);
      const total = Math.round(peak * (8 + rnd() * 10));
      if (total <= 0) continue;
      const failed = rnd() < 0.15 ? Math.round(total * (0.05 + rnd() * 0.15)) : 0;
      deliveryHeat.push({ day, hour, total, failed });
    }
  }

  const smsSpend: SpendPoint[] = buckets.map((b, i) => {
    const segments = delivery[i].total * (1 + Math.round(rnd()));
    return { date: b.date, label: b.label, cents: Math.round(segments * 0.83), segments };
  });

  const acqTotals: SourceSlice[] = [
    { source: "organic", label: "Organic", signups: 0, netCents: 0 },
    { source: "promo", label: "Promo code", signups: 0, netCents: 0 },
    { source: "referral", label: "Referral", signups: 0, netCents: 0 },
    { source: "cornerstone", label: "Cornerstone church", signups: 0, netCents: 0 },
    { source: "enrollment", label: "Church enrollment link", signups: 0, netCents: 0 },
  ];
  const totalSignups = signups.reduce((a, b) => a + b.signups, 0);
  const acqWeights = [0.42, 0.24, 0.14, 0.12, 0.08];
  acqTotals.forEach((a, i) => { a.signups = Math.round(totalSignups * acqWeights[i]); a.netCents = a.signups * (4200 + Math.round(rnd() * 1500)); });

  const funnelTop = Math.round(totalSignups * 1.35);
  const funnel: FunnelStage[] = [
    { key: "signups", label: "Started signup", count: funnelTop },
    { key: "sent", label: "SMS sent", count: Math.round(funnelTop * 0.88) },
    { key: "confirmed", label: "Confirmed (YES)", count: Math.round(funnelTop * 0.63) },
    { key: "subscribed", label: "Subscription created", count: Math.round(funnelTop * 0.55) },
    { key: "active", label: "Active now", count: activeSubs },
  ];

  const planMix: CountSlice[] = [
    { key: "individual_annual", label: "Individual (annual)", count: Math.round(activeSubs * 0.44) },
    { key: "individual_monthly", label: "Individual (monthly)", count: Math.round(activeSubs * 0.22) },
    { key: "family", label: "Family", count: Math.round(activeSubs * 0.18) },
    { key: "gift", label: "Gift", count: Math.round(activeSubs * 0.10) },
    { key: "group", label: "Group", count: Math.round(activeSubs * 0.06) },
  ];
  const themeMix: CountSlice[] = [
    { key: "general", label: "General", count: Math.round(activeSubs * 0.5) },
    { key: "anxiety", label: "Anxiety & peace", count: Math.round(activeSubs * 0.16) },
    { key: "identity", label: "Identity", count: Math.round(activeSubs * 0.13) },
    { key: "purpose", label: "Purpose", count: Math.round(activeSubs * 0.11) },
    { key: "relationships", label: "Relationships", count: Math.round(activeSubs * 0.1) },
  ];

  const contentRunway: RunwaySlice[] = [
    { track: "general", label: "General", runwayDays: 21, furthest: null },
    { track: "anxiety", label: "Anxiety & peace", runwayDays: 12, furthest: null },
    { track: "identity", label: "Identity", runwayDays: 6, furthest: null },
    { track: "purpose", label: "Purpose", runwayDays: 9, furthest: null },
    { track: "relationships", label: "Relationships", runwayDays: 3, furthest: null },
    { track: "temptation", label: "Temptation", runwayDays: null, furthest: null },
  ];

  // Promo performance — several codes with contrasting profiles.
  const promoSeed: { code: string; label: string; active: boolean; pct: number; signups: number; convRate: number; arpu: number }[] = [
    { code: "CHSPANTHERS15", label: "Catholic High Panthers", active: true, pct: 15, signups: 46, convRate: 0.72, arpu: 5900 },
    { code: "igy_episcopal", label: "Episcopal Church", active: true, pct: 15, signups: 31, convRate: 0.68, arpu: 5600 },
    { code: "igy_hardtner", label: "Camp Hardtner", active: true, pct: 10, signups: 22, convRate: 0.64, arpu: 5400 },
    { code: "SUMMER25", label: "Summer 25% push", active: true, pct: 25, signups: 58, convRate: 0.49, arpu: 4200 },
    { code: "WELCOME10", label: "Welcome 10", active: true, pct: 10, signups: 18, convRate: 0.7, arpu: 5700 },
    { code: "SPRINGFLING", label: "Spring fling (ended)", active: false, pct: 20, signups: 9, convRate: 0.33, arpu: 3800 },
  ];
  const promoPerf: PromoPerf[] = promoSeed.map((p) => {
    const conversions = Math.round(p.signups * p.convRate);
    const grossPer = Math.round(p.arpu / (1 - p.pct / 100));
    const grossCents = conversions * grossPer;
    const netCents = conversions * p.arpu;
    const discountCents = grossCents - netCents;
    const mrrCents = Math.round((netCents / 12) * 0.9);
    // ARPU is MONTHLY (mrr per converted user) so it's directly comparable to the
    // blended MRR/subs ARPU shown elsewhere — not the annual net-per-conversion.
    const arpuCents = conversions ? Math.round(mrrCents / conversions) : 0;
    return {
      code: p.code, label: p.label, active: p.active, redemptions: conversions,
      signups: p.signups, conversions, grossCents, netCents, discountCents,
      mrrCents, arpuCents, discountPct: p.pct,
    };
  }).sort((a, b) => b.netCents - a.netCents);

  const netRevenueCents = revenueTrend.reduce((a, b) => a + b.netCents, 0);
  const arpuCents = Math.round(mrrCents / activeSubs);
  const totalChurned = -churn.reduce((a, b) => a + b.churned, 0);
  const churnRatePct = (totalChurned / (activeSubs + totalChurned)) * 100;
  const totSends = delivery.reduce((a, b) => a + b.total, 0);
  const totDel = delivery.reduce((a, b) => a + b.delivered, 0);
  const deliveryRatePct = totSends ? (totDel / totSends) * 100 : null;

  return {
    range,
    demo: true,
    generatedAt: now.toISOString(),
    stripeError: null,
    headline: { mrrCents, arrCents: mrrCents * 12, activeSubs, arpuCents, netRevenueCents, newSignups: totalSignups, churnRatePct, deliveryRatePct },
    spark: {
      mrr: mrrTrend.map((m) => m.mrrCents),
      revenue: revenueTrend.map((r) => r.netCents),
      signups: signups.map((s) => s.signups),
      churn: churn.map((c) => -c.churned),
      delivery: delivery.map((d) => (d.total ? (d.delivered / d.total) * 100 : 0)),
    },
    revenueTrend,
    revenueDrill,
    mrrTrend,
    signups,
    acquisition: acqTotals.sort((a, b) => b.signups - a.signups),
    funnel,
    planMix,
    themeMix,
    churn,
    delivery,
    deliveryHeat,
    smsSpend,
    contentRunway,
    promoPerf,
    promoUsage: promoSeed.map((p) => ({ code: p.code, times_redeemed: Math.round(p.signups * p.convRate), active: p.active })),
    donationFund: { availableCents: 128_00, accruedCents: 512_00, disbursedCents: 384_00, lastCloseDate: isoDate(now) },
  };
}
