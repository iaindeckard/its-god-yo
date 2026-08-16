export interface ReinvestmentPolicy {
  enabled: boolean;
  reinvest_rate_bps: number;
  minimum_contacted: number;
  minimum_conversions: number;
  minimum_roi_bps: number;
  maximum_cycle_cents: number;
  maximum_campaign_share_bps: number;
}

export interface RoiCandidate {
  campaign_id: string;
  name: string;
  invested_cents: number;
  net_revenue_cents: number;
  reinvested_net_revenue_cents: number;
  contacted: number;
  conversions: number;
}

export interface ReinvestmentAllocation extends RoiCandidate {
  profit_cents: number;
  roi_bps: number;
  newly_realized_net_cents: number;
  allocated_cents: number;
}

export function calculateReinvestment(
  policy: ReinvestmentPolicy,
  candidates: RoiCandidate[],
): { pool_cents: number; realized_net_revenue_cents: number; allocations: ReinvestmentAllocation[] } {
  const normalized = candidates.map((candidate) => {
    const invested = Math.max(0, Math.floor(Number(candidate.invested_cents) || 0));
    const net = Math.max(0, Math.floor(Number(candidate.net_revenue_cents) || 0));
    const profit = net - invested;
    const roiBps = invested > 0 ? Math.floor((profit * 10000) / invested) : 0;
    return { ...candidate, invested_cents: invested, net_revenue_cents: net, profit_cents: profit, roi_bps: roiBps };
  });
  const realized = normalized.reduce((sum, row) => sum + row.net_revenue_cents, 0);
  if (!policy.enabled) return { pool_cents: 0, realized_net_revenue_cents: realized, allocations: [] };
  const eligible = normalized.map((row) => ({
    ...row,
    newly_realized_net_cents: Math.max(0, row.net_revenue_cents - Math.max(0, Math.floor(Number(row.reinvested_net_revenue_cents) || 0))),
  })).filter((row) => row.invested_cents > 0
    && row.contacted >= policy.minimum_contacted
    && row.conversions >= policy.minimum_conversions
    && row.profit_cents > 0
    && row.roi_bps >= policy.minimum_roi_bps
    && row.newly_realized_net_cents > 0);
  const eligibleNet = eligible.reduce((sum, row) => sum + row.newly_realized_net_cents, 0);
  const pool = Math.max(0, Math.min(
    Math.floor(policy.maximum_cycle_cents),
    Math.floor(eligibleNet * policy.reinvest_rate_bps / 10000),
  ));
  if (!pool || !eligible.length) return { pool_cents: 0, realized_net_revenue_cents: realized, allocations: [] };
  const totalProfit = eligible.reduce((sum, row) => sum + row.profit_cents, 0);
  const cap = Math.max(1, Math.floor(pool * policy.maximum_campaign_share_bps / 10000));
  const allocations = eligible.map((row) => ({
    ...row,
    allocated_cents: Math.min(cap, Math.floor(pool * row.profit_cents / totalProfit)),
  })).filter((row) => row.allocated_cents > 0);
  return {
    pool_cents: allocations.reduce((sum, row) => sum + row.allocated_cents, 0),
    realized_net_revenue_cents: realized,
    allocations,
  };
}
