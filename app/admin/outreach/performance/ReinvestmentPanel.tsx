"use client";

import { useState } from "react";

interface CampaignFinance { id: string; name: string; investment_cents: number; allocated_budget_cents: number }
interface Policy { enabled: boolean; reinvest_rate_bps: number; minimum_contacted: number; minimum_conversions: number; minimum_roi_bps: number; maximum_cycle_cents: number; maximum_campaign_share_bps: number }
interface Allocation { id: string; source_campaign_name: string; invested_cents: number; net_revenue_cents: number; newly_realized_net_cents: number; profit_cents: number; roi_bps: number; contacted: number; conversions: number; allocated_cents: number; created_campaign_id: string | null }
interface Proposal { id: string; period_start: string; period_end: string; status: string; proposed_reinvestment_cents: number; realized_net_revenue_cents: number; execution_error: string | null; outreach_reinvestment_allocations?: Allocation[] }

const money = (c: number) => "$" + (Number(c || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percent = (bps: number) => `${(Number(bps || 0) / 100).toFixed(1)}%`;

export default function ReinvestmentPanel({ initialCampaigns, initialPolicy, initialProposals, canManage, canApprove }: {
  initialCampaigns: CampaignFinance[]; initialPolicy: Policy; initialProposals: Proposal[]; canManage: boolean; canApprove: boolean;
}) {
  const [campaigns, setCampaigns] = useState(initialCampaigns);
  const [investmentDraft, setInvestmentDraft] = useState<Record<string, string>>(() => Object.fromEntries(initialCampaigns.map((campaign) => [campaign.id, (campaign.investment_cents / 100).toFixed(2)])));
  const [policy, setPolicy] = useState(initialPolicy);
  const [proposals, setProposals] = useState(initialProposals);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function refresh() {
    const res = await fetch("/api/admin/outreach/reinvestment", { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "refresh failed");
    setPolicy(data.policy); setProposals(data.proposals);
  }
  async function saveInvestment(campaign: CampaignFinance) {
    setBusy(`investment:${campaign.id}`); setError("");
    try {
      const cents = Math.round(Number(investmentDraft[campaign.id]) * 100);
      if (!Number.isSafeInteger(cents) || cents < 0) throw new Error("Enter a valid non-negative dollar amount.");
      const res = await fetch(`/api/admin/outreach/campaigns/${campaign.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ investment_cents: cents }) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error || "save failed");
      setCampaigns((rows) => rows.map((row) => row.id === campaign.id ? { ...row, investment_cents: cents } : row));
    } catch (e) { setError(e instanceof Error ? e.message : "save failed"); } finally { setBusy(null); }
  }
  async function post(body: Record<string, unknown>, key: string) {
    setBusy(key); setError("");
    try {
      const res = await fetch("/api/admin/outreach/reinvestment", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error || "request failed");
      await refresh();
      if (body.action === "generate" && !data.proposal) setError("No proposal was created: no campaign currently meets every investment, sample-size, conversion, and ROI threshold.");
    } catch (e) { setError(e instanceof Error ? e.message : "request failed"); } finally { setBusy(null); }
  }
  async function decide(id: string, action: "approve" | "reject") {
    setBusy(`${action}:${id}`); setError("");
    try {
      const res = await fetch(`/api/admin/outreach/reinvestment/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error || `${action} failed`); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : `${action} failed`); } finally { setBusy(null); }
  }

  return <div className="card" style={{ marginBottom: 18 }}>
    <h2>ROI reinvestment</h2>
    <p className="muted">Every Monday the system evaluates realized net revenue against recorded campaign investment. It proposes capped allocations automatically; approval creates draft campaigns only. Discovery, promotion, scheduling, and sending remain separate approvals.</p>
    {error && <div className="admin-note" role="alert">{error}</div>}
    <div className="row" style={{ gap: 14, flexWrap: "wrap" }}>
      <span className="pill">{policy.enabled ? "Automatic proposals on" : "Automatic proposals off"}</span>
      <span className="hint">Reinvest {percent(policy.reinvest_rate_bps)} · minimum ROI {percent(policy.minimum_roi_bps)} · minimum {policy.minimum_contacted} contacted / {policy.minimum_conversions} conversions · cycle cap {money(policy.maximum_cycle_cents)} · market cap {percent(policy.maximum_campaign_share_bps)}</span>
      {canManage && <button className="btn btn-ghost" disabled={busy === "toggle"} onClick={() => post({ action: "update_policy", policy: { enabled: !policy.enabled } }, "toggle")}>{policy.enabled ? "Pause proposals" : "Enable proposals"}</button>}
      {canManage && <button className="btn btn-primary" disabled={busy === "generate"} onClick={() => post({ action: "generate" }, "generate")}>{busy === "generate" ? "Calculating…" : "Calculate now"}</button>}
    </div>
    <h3 style={{ marginTop: 18 }}>Recorded campaign investment</h3>
    <div className="sim-scroll"><table className="table"><thead><tr><th>Campaign</th><th style={{ textAlign: "right" }}>Allocated budget</th><th style={{ textAlign: "right" }}>Actual investment</th></tr></thead><tbody>
      {campaigns.map((campaign) => <tr key={campaign.id}><td>{campaign.name}</td><td style={{ textAlign: "right" }}>{money(campaign.allocated_budget_cents)}</td><td style={{ textAlign: "right" }}>{canManage
        ? <span style={{ display: "inline-flex", gap: 6 }}><input aria-label={`Investment for ${campaign.name}`} type="number" min="0" step="0.01" value={investmentDraft[campaign.id] ?? ""} style={{ width: 120, textAlign: "right" }} onChange={(e) => setInvestmentDraft((draft) => ({ ...draft, [campaign.id]: e.target.value }))} disabled={busy === `investment:${campaign.id}`} /><button className="btn btn-ghost" disabled={busy === `investment:${campaign.id}`} onClick={() => saveInvestment(campaign)}>Save</button></span>
        : money(campaign.investment_cents)}</td></tr>)}
    </tbody></table></div>
    <h3 style={{ marginTop: 18 }}>Allocation proposals</h3>
    {proposals.length === 0 ? <p className="muted">No proposal yet. Campaigns without recorded investment are excluded from ROI.</p> : proposals.map((proposal) => <div key={proposal.id} className="admin-note" style={{ marginBottom: 10 }}>
      <div className="row" style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><strong>{proposal.period_start} to {proposal.period_end} · {proposal.status}</strong><span>Proposed {money(proposal.proposed_reinvestment_cents)} from {money(proposal.realized_net_revenue_cents)} realized net</span></div>
      {(proposal.outreach_reinvestment_allocations ?? []).map((allocation) => <div key={allocation.id} className="hint">{allocation.source_campaign_name}: invested {money(allocation.invested_cents)}, lifetime net {money(allocation.net_revenue_cents)}, new net {money(allocation.newly_realized_net_cents)}, ROI {percent(allocation.roi_bps)} → allocate {money(allocation.allocated_cents)}{allocation.created_campaign_id ? " · draft created" : ""}</div>)}
      {proposal.execution_error && <p className="danger-text">{proposal.execution_error}</p>}
      {proposal.status === "proposed" && canApprove && <div className="row" style={{ gap: 8, marginTop: 8 }}><button className="btn btn-primary" disabled={Boolean(busy)} onClick={() => decide(proposal.id, "approve")}>Approve and create drafts</button><button className="btn btn-ghost" disabled={Boolean(busy)} onClick={() => decide(proposal.id, "reject")}>Reject</button></div>}
    </div>)}
  </div>;
}
