import "server-only";
import { getSupabaseAdmin } from "../supabaseAdmin";
import type { SizeBucket } from "./campaigns";

/**
 * Phase 3 performance leaderboard reads. Two read-only views over the Phase 1
 * schema (see 20260807000002_outreach_performance_views.sql). Rates-first;
 * revenue is the FIRST-CHARGE basis (conversion_value_cents), clearly labeled in
 * the UI — the Phase 4 net-revenue join is deferred.
 */

export interface CampaignPerformance {
  campaign_id: string;
  name: string;
  region: string;
  radius_miles: number;
  size_filter: string[] | null;
  status: string;
  discount_percent: number;                // the campaign's offer (Phase 4a), for the Offer column
  message_variant: string | null;
  total_leads: number;
  contacted: number;
  offer_sent: number;
  redeemed: number;
  revenue_cents: number;                   // FIRST CHARGE (secondary)
  net_revenue_cents: number;               // realized net incl. renewals, net of fees/refunds/chargebacks (headline)
  conversion_pct: number | null;          // redeemed / contacted (null when contacted = 0)
  redeemed_of_offered_pct: number | null; // redeemed / offer_sent (null when offer_sent = 0)
}

export interface CampaignSizePerformance {
  campaign_id: string;
  name: string;
  region: string;
  size_bucket: SizeBucket;
  contacted: number;
  offer_sent: number;
  redeemed: number;
  revenue_cents: number;
  net_revenue_cents: number;
  conversion_pct: number | null;
}

export async function fetchCampaignPerformance(): Promise<CampaignPerformance[]> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("v_outreach_campaign_performance")
    .select("*")
    .order("conversion_pct", { ascending: false, nullsFirst: false })
    .order("contacted", { ascending: false });
  if (error) throw new Error(`fetch_campaign_performance_failed: ${error.message}`);
  return (data ?? []) as CampaignPerformance[];
}

export async function fetchCampaignSizePerformance(): Promise<CampaignSizePerformance[]> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("v_outreach_campaign_size_performance")
    .select("*");
  if (error) throw new Error(`fetch_campaign_size_performance_failed: ${error.message}`);
  return (data ?? []) as CampaignSizePerformance[];
}
