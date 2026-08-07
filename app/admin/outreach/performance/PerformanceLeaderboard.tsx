"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";

// Local view types (mirroring the server models; kept local so this client
// component never imports the server-only lib modules).
type SizeBucket = "small" | "medium" | "large" | "mega" | "unknown";
const BUCKETS: SizeBucket[] = ["small", "medium", "large", "mega", "unknown"];

interface CampaignPerformance {
  campaign_id: string; name: string; region: string; radius_miles: number;
  size_filter: string[] | null; status: string;
  total_leads: number; contacted: number; offer_sent: number; redeemed: number;
  revenue_cents: number; conversion_pct: number | null; redeemed_of_offered_pct: number | null;
}
interface CampaignSizePerformance {
  campaign_id: string; name: string; region: string; size_bucket: SizeBucket;
  contacted: number; offer_sent: number; redeemed: number;
  revenue_cents: number; conversion_pct: number | null;
}

const num = (v: unknown): number | null => (v == null ? null : Number(v));
const usd = (c: unknown) => "$" + (Number(c ?? 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (v: unknown) => (v == null ? "—" : `${Number(v)}%`);

type SortKey = "name" | "region" | "contacted" | "offer_sent" | "redeemed" | "conversion_pct" | "redeemed_of_offered_pct" | "revenue_cents";

// Nulls always sort last; numeric compare for numbers, locale for strings; ties
// broken by contacted desc so a rate tie surfaces the higher-volume campaign.
function makeCmp(key: SortKey, dir: "asc" | "desc") {
  return (a: Record<string, unknown>, b: Record<string, unknown>): number => {
    const av = a[key] as string | number | null, bv = b[key] as string | number | null;
    let r: number;
    if (av == null && bv == null) r = 0;
    else if (av == null) return 1;
    else if (bv == null) return -1;
    else r = typeof av === "string" ? av.localeCompare(String(bv)) : Number(av) - Number(bv);
    if (r === 0) r = Number(b.contacted ?? 0) - Number(a.contacted ?? 0); // volume tiebreak
    return dir === "desc" ? -r : r;
  };
}

export default function PerformanceLeaderboard({
  campaigns, sizeRows,
}: { campaigns: CampaignPerformance[]; sizeRows: CampaignSizePerformance[] }) {
  const [sizeFilter, setSizeFilter] = useState<"all" | SizeBucket>("all");
  const [sortKey, setSortKey] = useState<SortKey>("conversion_pct");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleSort(k: SortKey) {
    if (k === sortKey) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortKey(k); setSortDir(k === "name" || k === "region" ? "asc" : "desc"); }
  }
  const arrow = (k: SortKey) => (k === sortKey ? (sortDir === "desc" ? " ▾" : " ▴") : "");

  const cmp = useMemo(() => makeCmp(sortKey, sortDir), [sortKey, sortDir]);

  const campaignRows = useMemo(
    () => [...campaigns].sort((a, b) => cmp(a as unknown as Record<string, unknown>, b as unknown as Record<string, unknown>)),
    [campaigns, cmp],
  );
  const bucketRows = useMemo(
    () => (sizeFilter === "all" ? [] : sizeRows.filter((r) => r.size_bucket === sizeFilter)
      .sort((a, b) => cmp(a as unknown as Record<string, unknown>, b as unknown as Record<string, unknown>))),
    [sizeRows, sizeFilter, cmp],
  );
  const subRows = (id: string) =>
    sizeRows.filter((r) => r.campaign_id === id).sort((a, b) => (num(b.conversion_pct) ?? -1) - (num(a.conversion_pct) ?? -1) || b.contacted - a.contacted);

  const th = (label: string, k: SortKey, right = true) => (
    <th onClick={() => toggleSort(k)} style={{ cursor: "pointer", textAlign: right ? "right" : "left", whiteSpace: "nowrap" }}>{label}{arrow(k)}</th>
  );

  return (
    <div>
      <div className="admin-head">
        <h1>Outreach performance</h1>
        <p className="muted">
          A rates-first leaderboard by campaign (region) and church size.{" "}
          <Link href="/admin/outreach">← Back to campaigns</Link>
        </p>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Size bucket</label>
            <select value={sizeFilter} onChange={(e) => { setSizeFilter(e.target.value as "all" | SizeBucket); setExpanded(new Set()); }}>
              <option value="all">All sizes (per campaign)</option>
              {BUCKETS.map((b) => <option key={b} value={b}>{b} — across campaigns</option>)}
            </select>
          </div>
          <p className="hint" style={{ margin: 0, maxWidth: 520 }}>
            <strong>Conv %</strong> = redeemed ÷ contacted. <strong>Rd/offered %</strong> = redeemed ÷ churches sent the coded email. Revenue = first charge only. Global-cron leads (no campaign) are excluded.
          </p>
        </div>

        <div className="sim-scroll" style={{ marginTop: 12 }}>
          <table className="table">
            <thead>
              {sizeFilter === "all" ? (
                <tr>
                  <th style={{ textAlign: "right" }}>#</th>
                  {th("Campaign", "name", false)}
                  {th("Region", "region", false)}
                  <th style={{ textAlign: "left" }}>Size filter</th>
                  {th("Contacted", "contacted")}
                  {th("Offer sent", "offer_sent")}
                  {th("Redeemed", "redeemed")}
                  {th("Conv %", "conversion_pct")}
                  {th("Rd/offered %", "redeemed_of_offered_pct")}
                  {th("Revenue", "revenue_cents")}
                </tr>
              ) : (
                <tr>
                  <th style={{ textAlign: "right" }}>#</th>
                  {th("Campaign", "name", false)}
                  {th("Region", "region", false)}
                  {th("Contacted", "contacted")}
                  {th("Offer sent", "offer_sent")}
                  {th("Redeemed", "redeemed")}
                  {th("Conv %", "conversion_pct")}
                  {th("Revenue", "revenue_cents")}
                </tr>
              )}
            </thead>
            <tbody>
              {sizeFilter === "all" && campaignRows.length === 0 && (
                <tr><td colSpan={10} className="muted">No campaigns yet.</td></tr>
              )}
              {sizeFilter === "all" && campaignRows.map((c, i) => {
                const isOpen = expanded.has(c.campaign_id);
                return (
                  <Fragment key={c.campaign_id}>
                    <tr>
                      <td style={{ textAlign: "right" }} className="mono">{i + 1}</td>
                      <td>
                        <button className="btn btn-ghost" style={{ padding: "2px 6px", marginRight: 6 }}
                          onClick={() => setExpanded((s) => { const n = new Set(s); if (n.has(c.campaign_id)) n.delete(c.campaign_id); else n.add(c.campaign_id); return n; })}
                          aria-label={isOpen ? "Collapse" : "Expand size breakdown"}>{isOpen ? "▾" : "▸"}</button>
                        {c.name}
                      </td>
                      <td>{c.region}</td>
                      <td>{c.size_filter && c.size_filter.length
                        ? c.size_filter.map((b) => <span key={b} className="pill" style={{ marginRight: 4 }}>{b}</span>)
                        : <span className="muted">—</span>}</td>
                      <td style={{ textAlign: "right" }} className="mono">{c.contacted}</td>
                      <td style={{ textAlign: "right" }} className="mono">{c.offer_sent}</td>
                      <td style={{ textAlign: "right" }} className="mono">{c.redeemed}</td>
                      <td style={{ textAlign: "right", fontWeight: 700 }} className="mono">{pct(c.conversion_pct)}</td>
                      <td style={{ textAlign: "right" }} className="mono muted">{pct(c.redeemed_of_offered_pct)}</td>
                      <td style={{ textAlign: "right" }} className="mono">{usd(c.revenue_cents)}</td>
                    </tr>
                    {isOpen && subRows(c.campaign_id).map((s) => (
                      <tr key={c.campaign_id + s.size_bucket} style={{ background: "#f6faff" }}>
                        <td></td>
                        <td style={{ paddingLeft: 28 }} className="muted">↳ {s.size_bucket}</td>
                        <td></td><td></td>
                        <td style={{ textAlign: "right" }} className="mono">{s.contacted}</td>
                        <td style={{ textAlign: "right" }} className="mono">{s.offer_sent}</td>
                        <td style={{ textAlign: "right" }} className="mono">{s.redeemed}</td>
                        <td style={{ textAlign: "right" }} className="mono">{pct(s.conversion_pct)}</td>
                        <td></td>
                        <td style={{ textAlign: "right" }} className="mono">{usd(s.revenue_cents)}</td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })}

              {sizeFilter !== "all" && bucketRows.length === 0 && (
                <tr><td colSpan={8} className="muted">No {sizeFilter} leads in any campaign yet.</td></tr>
              )}
              {sizeFilter !== "all" && bucketRows.map((s, i) => (
                <tr key={s.campaign_id + s.size_bucket}>
                  <td style={{ textAlign: "right" }} className="mono">{i + 1}</td>
                  <td>{s.name}</td>
                  <td>{s.region}</td>
                  <td style={{ textAlign: "right" }} className="mono">{s.contacted}</td>
                  <td style={{ textAlign: "right" }} className="mono">{s.offer_sent}</td>
                  <td style={{ textAlign: "right" }} className="mono">{s.redeemed}</td>
                  <td style={{ textAlign: "right", fontWeight: 700 }} className="mono">{pct(s.conversion_pct)}</td>
                  <td style={{ textAlign: "right" }} className="mono">{usd(s.revenue_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
