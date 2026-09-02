"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import CampaignMap, { type CampaignMapChange, type MapLead } from "./CampaignMap";

// Local view types (mirroring the server models; kept local so this client
// component never imports the server-only lib modules).
type SizeBucket = "small" | "medium" | "large" | "mega" | "unknown";
const BUCKETS: SizeBucket[] = ["small", "medium", "large", "mega", "unknown"];
const BUCKET_LABEL: Record<SizeBucket, string> = {
  small: "Small (<100)", medium: "Medium (100–499)", large: "Large (500–1,999)",
  mega: "Mega (2,000+)", unknown: "Unknown",
};
const attendanceSourceName = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "") === "outreach100.com"
      ? "Outreach 100"
      : "published source";
  } catch {
    return "published source";
  }
};
const DENOMINATIONS = [
  { id: "usccb", label: "Roman Catholic" },
  { id: "episcopal", label: "Episcopal" },
  { id: "umc", label: "United Methodist" },
  { id: "elca", label: "ELCA Lutheran" },
  { id: "pcusa", label: "Presbyterian Church (U.S.A.)" },
  { id: "sbc", label: "Southern Baptist" },
  { id: "lcms", label: "Lutheran Church-Missouri Synod" },
] as const;
const US_STATES = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"],
  ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "District of Columbia"], ["FL", "Florida"],
  ["GA", "Georgia"], ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"],
  ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"], ["MD", "Maryland"],
  ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"], ["MO", "Missouri"],
  ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"], ["NH", "New Hampshire"], ["NJ", "New Jersey"],
  ["NM", "New Mexico"], ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"],
  ["OK", "Oklahoma"], ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"], ["SC", "South Carolina"],
  ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"], ["VT", "Vermont"],
  ["VA", "Virginia"], ["WA", "Washington"], ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"],
] as const;

interface Campaign {
  id: string; name: string; center_label: string;
  center_lat: number | null; center_lng: number | null;
  radius_miles: number; size_filter: string[] | null;
  denomination_filter: string[] | null;
  search_language: "en" | "es";
  discovery_target_count: number | null;
  geography_type: "radius" | "state"; state_code: string | null;
  status: string; created_at: string;
  discount_percent: number; message_variant: string | null;
  release_at: string | null; release_timezone: string | null;
  scheduled_at: string | null; release_started_at: string | null; release_completed_at: string | null;
  schedule_snapshot: { recipient_count?: number } | null;
}

// Approved message variants (mirror of lib/outreach/templates.ts, which is
// server-only). Adding a new variant is a reviewed change in BOTH places + the
// approved copy in email.ts — a campaign can only pick from this fixed set.
const MESSAGE_VARIANTS: { key: string; label: string }[] = [
  { key: "default", label: "Default (approved)" },
  { key: "catholic_school", label: "Catholic School (approved)" },
];
interface Lead {
  id: string; org_name: string; city: string | null; state: string | null;
  contact_email: string; website: string | null; status: string;
  discovery_confidence: string | null; size_bucket: SizeBucket;
  estimated_attendance: number | null; attendance_source_url: string | null;
  send_count: number; last_sent_at: string | null; promo_code: string | null;
  latitude: number | null; longitude: number | null;
  verification_status: string; verified_at: string | null;
  verification_notes: Record<string, unknown> | null;
}
interface SendItem { org_name: string; to: string; outcome: string; touch: number | null; promo_code: string; subject: string; }
interface SendReport {
  mode: string; gate_reasons: string[]; scanned: number; sent: number;
  would_send: number; not_due: number; complete: number; skipped: number;
  skipped_unverified: number; errors: number;
  items: SendItem[];
}
interface Delivery {
  id: string; lead_id: string; touch: number; status: string; provider_message_id: string | null;
  error: string | null; sent_at: string | null; delivered_at: string | null;
  last_event_at: string | null; last_event_type: string | null;
}
interface MarketRecommendation {
  market_name: string; state: string; center_label: string; radius_miles: number; score: number;
  why_now: string; audience: string; test_size: number; channels: string[];
  timing: { start: string; end: string; rationale: string };
  message: { theme: string; value_proposition: string; call_to_action: string; subject_line: string; opening: string };
  success_metrics: string[]; risks: string[]; assumptions: string[];
  evidence: { claim: string; url: string }[];
  profile: MarketProfile;
  campaign_strategy: Record<string, unknown>;
}
interface MarketingProposal {
  id: string; status: "draft" | "approved" | "rejected";
  analysis: { executive_summary: string; next_action: string; data_limitations: string[]; recommendations: MarketRecommendation[] };
  generated_drafts?: Array<{ recommendation_index: number; profile_id: string; campaign: Campaign }>;
}
interface MarketProfile {
  area_demographics: Record<string, unknown>; congregation_landscape: Record<string, unknown>;
  attendee_profile: { sourced_segments?: string[]; limitations?: string[] };
  economics: Record<string, unknown>; public_outreach: { signals?: string[]; opportunities?: string[] };
  campaign_strategy: Record<string, unknown>; evidence: Array<{ category?: string; publisher?: string; claim: string; url: string }>;
  data_limitations: string[];
}
interface AiUsageSummary { month: string; spentMicrousd: number; reservedMicrousd: number; budgetMicrousd: number }
interface DiscoveryRun {
  status: "running" | "processing" | "completed" | "failed"; round_count: number; max_rounds: number;
  found_count: number; inserted_count: number; skipped_count: number; out_of_radius_count: number;
  target_count: number; last_error: string | null;
}

const statusPill = (s: string) =>
  s === "active" ? "pill pill-on"
  : s === "converted" ? "pill pill-on"
  : s === "staged" ? "pill pill-warn"
  : s === "needs_review" ? "pill pill-warn"
  : "pill pill-off";

const deliveryStatusPill = (s: string) =>
  s === "delivered" ? "pill pill-on"
  : ["sent", "claimed", "delayed"].includes(s) ? "pill pill-warn"
  : "pill pill-off";

const verifyPill = (s: string) =>
  s === "passed" ? "pill pill-on"
  : s === "manual_override" ? "pill pill-on"
  : s === "needs_manual" ? "pill pill-warn"
  : s === "failed" ? "pill pill-off"
  : "pill"; // unverified

function toDateTimeLocal(value: string): string {
  const date = new Date(value);
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

// Turn the machine verification_notes into one plain-language line so an override
// decision is informed without leaving the page. Returns null when there is
// nothing to explain (a passed/override lead, or missing notes).
function verificationReason(notes: Record<string, unknown> | null): string | null {
  if (!notes) return null;
  const bits: string[] = [];
  if (notes.mx_ok === false) {
    bits.push(notes.mx_reason === "no_mx_or_a_record"
      ? "email domain does not accept mail"
      : "email failed its format or domain check");
  }
  const pageOk = notes.org_match === true && notes.youth_match === true;
  if (!pageOk) {
    const r = typeof notes.page_reason === "string" ? notes.page_reason : "";
    if (r === "no_source_urls") bits.push("no source page was cited");
    else if (r.startsWith("non_html")) bits.push("cited source is a non-HTML file (e.g. a PDF)");
    else if (r === "timeout") bits.push("cited page timed out");
    else if (r.startsWith("http_")) bits.push(`cited page returned ${r.replace("http_", "HTTP ")}`);
    else if (r === "empty_after_strip") bits.push("cited page had no readable text (likely a JavaScript-only site)");
    else if (r === "invalid_url" || r === "non_http_url" || r === "fetch_error") bits.push("cited page could not be fetched");
    else if (r === "page_missing_org_or_youth") {
      if (notes.org_match !== true && notes.youth_match !== true) bits.push("page showed neither the church name nor a youth-ministry signal (may be a JavaScript-only site)");
      else if (notes.youth_match !== true) bits.push("no youth-ministry signal on the cited page");
      else bits.push("church name not found on the cited page");
    } else {
      bits.push("cited page could not be confirmed");
    }
  }
  return bits.length ? bits.join("; ") : null;
}

const toMapLeads = (ls: Lead[]): MapLead[] =>
  ls.map((l) => ({ id: l.id, org_name: l.org_name, status: l.status, latitude: l.latitude, longitude: l.longitude, size_bucket: l.size_bucket }));

function DenominationPicker({ value, onChange, disabled = false }: {
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: "12px 0" }}>
      <legend style={{ fontWeight: 600, fontSize: 13, marginBottom: 7 }}>Denominations</legend>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 14px" }}>
        {DENOMINATIONS.map((denomination) => (
          <label key={denomination.id} style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13 }}>
            <input type="checkbox" checked={value.includes(denomination.id)} onChange={(event) => {
              onChange(event.target.checked
                ? [...value, denomination.id]
                : value.filter((id) => id !== denomination.id));
            }} />
            {denomination.label}
          </label>
        ))}
      </div>
      <p className="hint" style={{ margin: "7px 0 0" }}>
        {value.length
          ? "Discovery will use only the selected denominations' official directories."
          : "No selection means all configured official directories, followed by the secondary-web fallback."}
      </p>
    </fieldset>
  );
}

const launchDate = (campaign: Campaign): Date | null => {
  const value = campaign.release_started_at ?? campaign.release_completed_at;
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const calendarKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

function CampaignBrowser({ campaigns, selectedId, onOpen }: {
  campaigns: Campaign[];
  selectedId: string | null;
  onOpen: (campaign: Campaign) => void;
}) {
  const [view, setView] = useState<"locations" | "calendar">("locations");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const latestLaunch = campaigns.map(launchDate).filter((date): date is Date => date !== null).sort((a, b) => b.getTime() - a.getTime())[0];
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const date = latestLaunch ?? new Date();
    return new Date(date.getFullYear(), date.getMonth(), 1);
  });
  const launchesByDay = useMemo(() => {
    const map = new Map<string, Campaign[]>();
    campaigns.forEach((campaign) => {
      const date = launchDate(campaign);
      if (!date) return;
      const key = calendarKey(date);
      map.set(key, [...(map.get(key) ?? []), campaign]);
    });
    return map;
  }, [campaigns]);
  const locationGroups = useMemo(() => {
    const map = new Map<string, Campaign[]>();
    campaigns.forEach((campaign) => {
      const label = campaign.center_label.trim() || "Location not set";
      map.set(label, [...(map.get(label) ?? []), campaign]);
    });
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [campaigns]);
  const monthStartDay = visibleMonth.getDay();
  const daysInMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0).getDate();
  const calendarCells = Array.from({ length: monthStartDay + daysInMonth }, (_, index) => index < monthStartDay ? null : index - monthStartDay + 1);

  return (
    <details>
      <summary style={{ cursor: "pointer", listStyle: "none", display: "flex", alignItems: "center", gap: 8 }}>
        <span aria-hidden="true">▸</span>
        <strong>Campaign history</strong>
        <span className="muted">{campaigns.length} {campaigns.length === 1 ? "campaign" : "campaigns"}</span>
      </summary>
      <div style={{ paddingTop: 14 }}>
        <div role="group" aria-label="Campaign history view" style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          <button className={view === "locations" ? "btn btn-primary" : "btn btn-ghost"} onClick={() => setView("locations")}>Locations</button>
          <button className={view === "calendar" ? "btn btn-primary" : "btn btn-ghost"} onClick={() => setView("calendar")}>Calendar</button>
        </div>

        {view === "locations" ? (
          <div style={{ display: "grid", gap: 10 }}>
            {locationGroups.map(([location, items]) => (
              <div key={location} style={{ borderTop: "1px solid var(--border, #e5e7eb)", paddingTop: 10 }}>
                <strong style={{ fontSize: 13 }}>{location}</strong>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 7 }}>
                  {items.map((campaign) => (
                    <button key={campaign.id} className="btn btn-ghost" style={{ fontWeight: selectedId === campaign.id ? 700 : 400 }} onClick={() => onOpen(campaign)}>
                      {campaign.name} <span className={statusPill(campaign.status)} style={{ marginLeft: 4 }}>{campaign.status}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ maxWidth: 560 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <button className="btn btn-ghost" aria-label="Previous month" onClick={() => { setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1)); setSelectedDay(null); }}>←</button>
              <strong>{visibleMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</strong>
              <button className="btn btn-ghost" aria-label="Next month" onClick={() => { setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1)); setSelectedDay(null); }}>→</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 4, textAlign: "center" }}>
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span key={day} className="muted" style={{ fontSize: 12, padding: 4 }}>{day}</span>)}
              {calendarCells.map((day, index) => {
                if (day === null) return <span key={`empty-${index}`} />;
                const date = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), day);
                const launched = launchesByDay.get(calendarKey(date)) ?? [];
                const isActive = launched.length > 0;
                return (
                  <button
                    key={day}
                    className={isActive ? "btn btn-primary" : "btn btn-ghost"}
                    disabled={!isActive}
                    aria-label={isActive ? `${date.toLocaleDateString()}: ${launched.length} launched ${launched.length === 1 ? "campaign" : "campaigns"}` : date.toLocaleDateString()}
                    title={isActive ? launched.map((campaign) => campaign.name).join(", ") : undefined}
                    onClick={() => isActive && setSelectedDay(calendarKey(date))}
                    style={{ minWidth: 0, padding: "8px 4px", fontWeight: isActive ? 700 : 400, opacity: 1 }}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
            {selectedDay && launchesByDay.has(selectedDay) && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                {(launchesByDay.get(selectedDay) ?? []).map((campaign) => (
                  <button key={campaign.id} className="btn btn-ghost" style={{ fontWeight: selectedId === campaign.id ? 700 : 400 }} onClick={() => onOpen(campaign)}>
                    {campaign.name} <span className={statusPill(campaign.status)} style={{ marginLeft: 4 }}>{campaign.status}</span>
                  </button>
                ))}
              </div>
            )}
            <p className="hint" style={{ marginBottom: 0 }}>Highlighted dates have a recorded campaign launch. Choose a date, then a campaign; ordinary dates are intentionally inactive.</p>
          </div>
        )}
      </div>
    </details>
  );
}

export default function OutreachManager({
  initialCampaigns, canManage, canOverride, initialAiUsage,
}: { initialCampaigns: Campaign[]; canManage: boolean; canOverride: boolean; initialAiUsage: AiUsageSummary }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>(initialCampaigns);
  const [selected, setSelected] = useState<Campaign | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [discoveryRun, setDiscoveryRun] = useState<DiscoveryRun | null>(null);
  const [viewBucket, setViewBucket] = useState<"all" | SizeBucket>("all");
  const [promoteSel, setPromoteSel] = useState<Set<string>>(new Set());
  const [audienceSel, setAudienceSel] = useState<Set<string>>(new Set());
  const [report, setReport] = useState<SendReport | null>(null);
  const [createName, setCreateName] = useState("");
  const [createGeographyType, setCreateGeographyType] = useState<"radius" | "state">("radius");
  const [createStateCode, setCreateStateCode] = useState("FL");
  const [createLanguage, setCreateLanguage] = useState<"en" | "es">("en");
  const [createDenominations, setCreateDenominations] = useState<string[]>([]);
  const [createDraft, setCreateDraft] = useState<CampaignMapChange | null>(null);
  const [detailDraft, setDetailDraft] = useState<CampaignMapChange | null>(null);
  const [denominationDraft, setDenominationDraft] = useState<string[]>([]);
  const [offerDraft, setOfferDraft] = useState<{ discount_percent: string; message_variant: string } | null>(null);
  const [releaseDraft, setReleaseDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contactEdit, setContactEdit] = useState<{ leadId: string; email: string; sourceUrl: string; manuallyConfirmed: boolean } | null>(null);
  const [analystForm, setAnalystForm] = useState({
    objective: "church_enrollment", audience: "Church youth leaders and parents",
    budget_level: "small_test", preferred_window: "", constraints: "",
  });
  const [proposal, setProposal] = useState<MarketingProposal | null>(null);
  const [aiUsage, setAiUsage] = useState(initialAiUsage);
  const [marketProfile, setMarketProfile] = useState<MarketProfile | null>(null);

  async function refreshCampaigns() {
    const res = await fetch("/api/admin/outreach/campaigns");
    const data = await res.json();
    if (res.ok) setCampaigns(data.campaigns);
  }

  async function openCampaign(c: Campaign) {
    setSelected(c); setLeads([]); setDeliveries([]); setDiscoveryRun(null); setMarketProfile(null); setReport(null); setViewBucket("all"); setPromoteSel(new Set()); setAudienceSel(new Set()); setDetailDraft(null); setOfferDraft(null); setContactEdit(null);
    const res = await fetch(`/api/admin/outreach/campaigns/${c.id}`);
    const data = await res.json();
    if (res.ok) {
      setSelected(data.campaign); setLeads(data.leads); setDeliveries(data.deliveries ?? []); setDiscoveryRun(data.discoveryRun ?? null);
      setMarketProfile(data.marketProfile ?? null);
      setDenominationDraft(data.campaign.denomination_filter ?? []);
      setReleaseDraft(data.campaign.release_at ? toDateTimeLocal(data.campaign.release_at) : "");
      setOfferDraft({ discount_percent: String(data.campaign.discount_percent ?? 10), message_variant: data.campaign.message_variant ?? "default" });
    } else setError(data.error || "failed to load campaign");
  }

  // Deselect => Step 1 create mode (draw a new area). One control drives the
  // mode switch; the single map remounts via key={selected?.id ?? "new"}.
  function newCampaign() {
    setSelected(null); setLeads([]); setDiscoveryRun(null); setReport(null);
    setViewBucket("all"); setPromoteSel(new Set()); setAudienceSel(new Set());
    setDetailDraft(null); setOfferDraft(null); setError(null);
    setCreateName(""); setCreateDraft(null); setCreateGeographyType("radius"); setCreateStateCode("FL"); setCreateLanguage("en"); setCreateDenominations([]); setDenominationDraft([]); setContactEdit(null);
  }

  async function createCampaign() {
    setError(null);
    if (!createName.trim()) { setError("Name is required."); return; }
    if (createGeographyType === "radius" && !createDraft) { setError("Pick a center on the map (click, drag, or search)."); return; }
    setBusy("create");
    try {
      const res = await fetch("/api/admin/outreach/campaigns", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: createName,
          center_label: createGeographyType === "state"
            ? US_STATES.find(([code]) => code === createStateCode)?.[1] ?? createStateCode
            : createDraft?.center_label || createName,
          center_lat: createGeographyType === "radius" ? createDraft?.center_lat : null,
          center_lng: createGeographyType === "radius" ? createDraft?.center_lng : null,
          radius_miles: createGeographyType === "radius" ? createDraft?.radius_miles : 1,
          geography_type: createGeographyType,
          state_code: createGeographyType === "state" ? createStateCode : null,
          denomination_filter: createDenominations,
          search_language: createLanguage,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "create failed");
      setCreateName(""); setCreateDraft(null); setCreateGeographyType("radius"); setCreateStateCode("FL"); setCreateLanguage("en"); setCreateDenominations([]);
      await refreshCampaigns();
      await openCampaign(data.campaign);
    } catch (e) { setError(e instanceof Error ? e.message : "create failed"); }
    finally { setBusy(null); }
  }

  async function saveTargeting() {
    if (!selected) return;
    setError(null); setBusy("save-center");
    try {
      const res = await fetch(`/api/admin/outreach/campaigns/${selected.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(detailDraft ? {
            center_lat: detailDraft.center_lat, center_lng: detailDraft.center_lng,
            radius_miles: detailDraft.radius_miles, center_label: detailDraft.center_label,
          } : {}),
          ...(!discoveryRun ? { denomination_filter: denominationDraft } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "save failed");
      setDetailDraft(null);
      await refreshCampaigns();
      await openCampaign(data.campaign);
    } catch (e) { setError(e instanceof Error ? e.message : "save failed"); }
    finally { setBusy(null); }
  }

  async function changeLanguage(lang: "en" | "es") {
    if (!selected || lang === selected.search_language) return;
    setError(null); setBusy("save-language");
    try {
      const res = await fetch(`/api/admin/outreach/campaigns/${selected.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ search_language: lang }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "save failed");
      await refreshCampaigns();
      await openCampaign(data.campaign);
    } catch (e) { setError(e instanceof Error ? e.message : "save failed"); }
    finally { setBusy(null); }
  }

  async function saveOffer() {
    if (!selected || !offerDraft) return;
    setError(null); setBusy("save-offer");
    try {
      const res = await fetch(`/api/admin/outreach/campaigns/${selected.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ discount_percent: Number(offerDraft.discount_percent), message_variant: offerDraft.message_variant }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "save failed");
      await openCampaign(selected);
    } catch (e) { setError(e instanceof Error ? e.message : "save failed"); }
    finally { setBusy(null); }
  }

  async function runDiscovery() {
    if (!selected) return;
    setError(null); setBusy("discover");
    try {
      let complete = false;
      while (!complete) {
        const res = await fetch(`/api/admin/outreach/campaigns/${selected.id}/discover`, { method: "POST" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "discovery failed");
        const run = data.run as DiscoveryRun;
        setDiscoveryRun(run);
        complete = run.status === "completed" || run.status === "failed";
        if (run.status === "failed") throw new Error(run.last_error || "discovery failed");
        if (!complete) await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
      await openCampaign(selected);
      await refreshCampaigns();
    } catch (e) { setError(e instanceof Error ? e.message : "discovery failed"); }
    finally { setBusy(null); }
  }

  async function verifyLeadsRun() {
    if (!selected) return;
    setError(null); setBusy("verify");
    try {
      const res = await fetch(`/api/admin/outreach/campaigns/${selected.id}/verify`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "verify failed");
      await openCampaign(selected);
    } catch (e) { setError(e instanceof Error ? e.message : "verify failed"); }
    finally { setBusy(null); }
  }

  async function overrideVerification(leadId: string) {
    setError(null); setBusy(`override:${leadId}`);
    try {
      const res = await fetch(`/api/admin/outreach/leads/${leadId}/verify-override`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "override failed");
      if (selected) await openCampaign(selected);
    } catch (e) { setError(e instanceof Error ? e.message : "override failed"); }
    finally { setBusy(null); }
  }

  async function updateContactEmail() {
    if (!selected || !contactEdit) return;
    setError(null); setBusy(`contact:${contactEdit.leadId}`);
    try {
      const res = await fetch(`/api/admin/outreach/leads/${contactEdit.leadId}/contact-email`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: contactEdit.email, source_url: contactEdit.sourceUrl, manually_confirmed: contactEdit.manuallyConfirmed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "email update failed");
      setContactEdit(null);
      await openCampaign(selected);
    } catch (e) { setError(e instanceof Error ? e.message : "email update failed"); }
    finally { setBusy(null); }
  }

  async function promote() {
    if (!selected || promoteSel.size === 0) return;
    setError(null); setBusy("promote");
    try {
      const res = await fetch(`/api/admin/outreach/campaigns/${selected.id}/promote`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [...promoteSel] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "promote failed");
      setPromoteSel(new Set());
      await openCampaign(selected);
    } catch (e) { setError(e instanceof Error ? e.message : "promote failed"); }
    finally { setBusy(null); }
  }

  async function send(live: boolean) {
    if (!selected || audienceSel.size === 0) return;
    const selectedAudience = [...audienceSel];
    if (live && !confirm("Send LIVE to this campaign's active leads? This puts real email in front of real churches (subject to the send gate).")) return;
    setError(null); setBusy(live ? "send-live" : "send-dry"); setReport(null);
    try {
      const res = await fetch(`/api/admin/outreach/campaigns/${selected.id}/send`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ dry: !live, leadIds: selectedAudience }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "send failed");
      // Refresh the campaign/leads FIRST, then set the report LAST: openCampaign
      // clears report (setReport(null)) at its start, so setting the report before
      // it would be instantly clobbered (the "flash then vanish" bug). The report
      // is a persistent card that must stay until the next action.
      await openCampaign(selected);
      setAudienceSel(new Set(selectedAudience));
      setReport(data.report);
    } catch (e) { setError(e instanceof Error ? e.message : "send failed"); }
    finally { setBusy(null); }
  }

  async function scheduleRelease() {
    if (!selected || !releaseDraft || audienceSel.size === 0) return;
    const release = new Date(releaseDraft);
    if (!Number.isFinite(release.getTime()) || release.getTime() <= Date.now()) { setError("Choose a future release date and time."); return; }
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago";
    if (!confirm(`Schedule ${audienceSel.size} selected recipients for ${release.toLocaleString()} (${timezone})? The exact verified active audience and approved offer will be recorded.`)) return;
    setError(null); setBusy("schedule");
    try {
      const res = await fetch(`/api/admin/outreach/campaigns/${selected.id}/schedule`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ release_at: release.toISOString(), timezone, lead_ids: [...audienceSel] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "schedule failed");
      await refreshCampaigns(); await openCampaign(data.campaign);
    } catch (e) { setError(e instanceof Error ? e.message : "schedule failed"); }
    finally { setBusy(null); }
  }

  async function pauseRelease() {
    if (!selected || !confirm("Pause this scheduled release? No campaign email will be released until you schedule it again.")) return;
    setError(null); setBusy("pause");
    try {
      const res = await fetch(`/api/admin/outreach/campaigns/${selected.id}/schedule`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "pause failed");
      await refreshCampaigns(); await openCampaign(data.campaign);
    } catch (e) { setError(e instanceof Error ? e.message : "pause failed"); }
    finally { setBusy(null); }
  }

  async function runAnalyst() {
    if (!confirm("Run sourced market research and automatically create up to three DRAFT campaigns? This request is capped at an estimated maximum of $0.10 and counts toward the monthly AI budget. Nothing will be discovered, promoted, scheduled, or sent.")) return;
    setError(null); setBusy("analyst"); setProposal(null);
    try {
      const requestId = crypto.randomUUID();
      const res = await fetch("/api/admin/outreach/analyst", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...analystForm, request_id: requestId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "marketing analysis failed");
      setProposal(data.proposal);
      if (data.aiUsage) setAiUsage(data.aiUsage);
    } catch (e) { setError(e instanceof Error ? e.message : "marketing analysis failed"); }
    finally { setBusy(null); }
  }

  async function openGeneratedDraft(marketIndex: number) {
    const draft = proposal?.generated_drafts?.find((row) => row.recommendation_index === marketIndex);
    if (!draft) return;
    await refreshCampaigns();
    await openCampaign(draft.campaign);
  }

  const shown = viewBucket === "all" ? leads : leads.filter((l) => l.size_bucket === viewBucket);
  const verificationCurrent = (lead: Lead) => {
    if (!lead.verified_at) return false;
    if (lead.verification_status !== "passed" && lead.verification_status !== "manual_override") return false;
    const ageDays = (Date.now() - new Date(lead.verified_at).getTime()) / 86_400_000;
    return Number.isFinite(ageDays) && ageDays <= 90;
  };
  const promotable = (lead: Lead) => lead.status === "staged" && verificationCurrent(lead);
  const releasable = (lead: Lead) => lead.status === "active" && verificationCurrent(lead);
  const shownPromotable = shown.filter(promotable);
  const shownReleasable = shown.filter(releasable);

  return (
    <div>
      <div className="admin-head">
        <h1>Outreach campaigns</h1>
        <p className="muted">
          A guided flow: define an area, discover churches, review and verify, set the offer and promote, then preview and send.{" "}
          <Link href="/admin/outreach/performance">View performance →</Link>
        </p>
      </div>

      {error && <div className="card" style={{ borderColor: "#c0392b", color: "#c0392b" }}>{error}</div>}

      <section className="card" style={{ borderColor: "#8aa9ca", background: "linear-gradient(135deg, #f4f8fc 0%, #fff 65%)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ maxWidth: 720 }}>
            <div className="pill pill-on" style={{ marginBottom: 8 }}>AI decision support</div>
            <h2 style={{ margin: 0 }}>Marketing analyst</h2>
            <p className="muted" style={{ marginBottom: 0 }}>
              Build evidence-backed market profiles and draft campaigns using authoritative public research plus locally aggregated verified IGY data. Drafts are created automatically, while all existing discovery, lead, copy, legal, schedule, and send gates remain in force.
            </p>
          </div>
          <div className="pill pill-warn">Manual approval required</div>
        </div>

        {canManage ? (
          <div style={{ marginTop: 18 }}>
            <div className="row" style={{ gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div className="field" style={{ margin: 0, minWidth: 210 }}><label>Goal</label>
                <select value={analystForm.objective} onChange={(e) => setAnalystForm((form) => ({ ...form, objective: e.target.value }))}>
                  <option value="church_enrollment">Church enrollment</option><option value="parent_purchases">Parent purchases</option>
                  <option value="referral_growth">Referral growth</option><option value="seasonal_promotion">Seasonal promotion</option>
                  <option value="retention_reactivation">Retention or reactivation</option><option value="partner_recruitment">Partner recruitment</option>
                </select>
              </div>
              <div className="field" style={{ margin: 0, minWidth: 240, flex: 1 }}><label>Audience</label>
                <input value={analystForm.audience} onChange={(e) => setAnalystForm((form) => ({ ...form, audience: e.target.value }))} />
              </div>
              <div className="field" style={{ margin: 0, minWidth: 160 }}><label>Budget posture</label>
                <select value={analystForm.budget_level} onChange={(e) => setAnalystForm((form) => ({ ...form, budget_level: e.target.value }))}>
                  <option value="small_test">Small test</option><option value="moderate">Moderate</option><option value="growth">Growth</option>
                </select>
              </div>
            </div>
            <div className="row" style={{ gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginTop: 12 }}>
              <div className="field" style={{ margin: 0, minWidth: 220 }}><label>Preferred timing (optional)</label>
                <input value={analystForm.preferred_window} placeholder="Let the analyst recommend" onChange={(e) => setAnalystForm((form) => ({ ...form, preferred_window: e.target.value }))} />
              </div>
              <div className="field" style={{ margin: 0, minWidth: 280, flex: 1 }}><label>Constraints</label>
                <input value={analystForm.constraints} placeholder="Add any optional limits or exclusions" onChange={(e) => setAnalystForm((form) => ({ ...form, constraints: e.target.value }))} />
              </div>
              <button className="btn btn-primary" disabled={!!busy || !analystForm.audience.trim()} onClick={runAnalyst}>
                {busy === "analyst" ? "Researching markets..." : "Recommend my next campaign"}
              </button>
            </div>
            <p className="hint" style={{ marginBottom: 0 }}>OpenAI uses current public web sources plus the constraints you provide. Maximum reserved cost per run: $0.10. {aiUsage.month} tracked usage: ${(aiUsage.spentMicrousd / 1_000_000).toFixed(2)} spent, ${(aiUsage.reservedMicrousd / 1_000_000).toFixed(2)} active reservations, ${(aiUsage.budgetMicrousd / 1_000_000).toFixed(2)} monthly cap. It does not send, schedule, promote, or change campaign gates.</p>
          </div>
        ) : <p className="muted">You can view campaigns, but marketing.outreach.manage is required to generate or approve a proposal.</p>}

        {proposal && (
          <div style={{ marginTop: 20, borderTop: "1px solid #cad8e6", paddingTop: 18 }}>
            <h3 style={{ marginTop: 0 }}>Analyst recommendation</h3>
            <p>{proposal.analysis.executive_summary}</p>
            <p className="hint"><strong>Suggested next action:</strong> {proposal.analysis.next_action}</p>
            <div style={{ display: "grid", gap: 12 }}>
              {proposal.analysis.recommendations.map((market, index) => (
                <article key={`${market.center_label}-${index}`} style={{ border: "1px solid #d9e2eb", borderRadius: 10, padding: 16, background: "#fff" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <div><h3 style={{ margin: 0 }}>{index + 1}. {market.market_name}</h3><p className="muted" style={{ margin: "4px 0 0" }}>{market.center_label} · {market.radius_miles} miles · test {market.test_size} contacts</p></div>
                    <span className="pill pill-on">Priority {market.score}/100</span>
                  </div>
                  <p><strong>Why now:</strong> {market.why_now}</p>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                    <div><strong>Audience</strong><p className="muted">{market.audience}</p></div>
                    <div><strong>Timing</strong><p className="muted">{market.timing.start} to {market.timing.end}<br />{market.timing.rationale}</p></div>
                    <div><strong>Message direction</strong><p className="muted">{market.message.theme}<br />{market.message.value_proposition}<br />CTA: {market.message.call_to_action}</p></div>
                  </div>
                  <details><summary><strong>Draft copy, evidence, risks, and measurement</strong></summary>
                    <div style={{ paddingTop: 10 }}>
                      <p><strong>Subject:</strong> {market.message.subject_line}<br /><strong>Opening:</strong> {market.message.opening}</p>
                      <p><strong>Channels:</strong> {market.channels.join(", ") || "Not specified"}</p>
                      <p><strong>Measure:</strong> {market.success_metrics.join("; ") || "Not specified"}</p>
                      <p><strong>Risks:</strong> {market.risks.join("; ") || "None listed"}</p>
                      <p><strong>Assumptions:</strong> {market.assumptions.join("; ") || "None listed"}</p>
                      <strong>Sources</strong><ul>{market.evidence.map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.claim}</a></li>)}</ul>
                    </div>
                  </details>
                  <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 8, background: "#fff8ec" }}>
                    <strong>Draft created automatically:</strong> verified IGY data is combined locally with the cited public profile. Draft copy stays advisory and cannot enter the send system until separately reviewed and added as an approved message variant.
                  </div>
                  <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={!proposal.generated_drafts?.some((row) => row.recommendation_index === index) || !!busy} onClick={() => openGeneratedDraft(index)}>
                    Open generated draft campaign
                  </button>
                </article>
              ))}
            </div>
            {proposal.analysis.data_limitations.length > 0 && <p className="hint" style={{ marginBottom: 0 }}><strong>Data limits:</strong> {proposal.analysis.data_limitations.join("; ")}</p>}
          </div>
        )}
      </section>

      {selected && marketProfile && (
        <section className="card" style={{ borderColor: "#8aa9ca", background: "#f7fbff" }}>
          <h3 style={{ marginTop: 0 }}>Verified market intelligence behind this draft</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <div><strong>Area demographics</strong><pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{JSON.stringify(marketProfile.area_demographics, null, 2)}</pre></div>
            <div><strong>Congregation landscape</strong><pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{JSON.stringify(marketProfile.congregation_landscape, null, 2)}</pre></div>
            <div><strong>Economics</strong><pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{JSON.stringify(marketProfile.economics, null, 2)}</pre></div>
            <div><strong>Campaign strategy</strong><pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{JSON.stringify(marketProfile.campaign_strategy, null, 2)}</pre></div>
          </div>
          <p><strong>Published attendee segments:</strong> {marketProfile.attendee_profile?.sourced_segments?.join("; ") || "Unknown. No congregation-specific published evidence."}</p>
          <p><strong>Public outreach:</strong> {marketProfile.public_outreach?.signals?.join("; ") || "No sourced signals recorded."}</p>
          <details><summary><strong>Sources and limitations</strong></summary>
            <ul>{marketProfile.evidence.map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.publisher ? `${source.publisher}: ` : ""}{source.claim}</a></li>)}</ul>
            <p className="hint">{marketProfile.data_limitations.join("; ")}</p>
          </details>
          <p className="hint" style={{ marginBottom: 0 }}>This profile created a draft only. Discovery, contact promotion, copy approval, legal approval, scheduling, and sending remain separate human-controlled steps.</p>
        </section>
      )}

      {/* Compact campaign history + persistent create action. */}
      <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "start" }}>
        {campaigns.length === 0
          ? <span className="muted">No campaigns yet.</span>
          : <div style={{ flex: "1 1 320px", minWidth: 0 }}><CampaignBrowser campaigns={campaigns} selectedId={selected?.id ?? null} onOpen={openCampaign} /></div>}
        {canManage && (
          <button className="btn btn-primary" onClick={newCampaign} disabled={!selected && !createName && !createDraft}>
            + New campaign
          </button>
        )}
      </div>

      {/* STEP 1 — Define area (single mode-switched map) */}
      <div className="card">
        <h3>1 · Define area</h3>
        {!selected
          ? <p className="muted">Draw a search area for a new campaign: name it, then click the map, drag the pin, or search a place to set the center, and use the slider for the radius.</p>
          : <p className="muted">{selected.center_label}{selected.geography_type === "radius" ? ` · ${Number(selected.radius_miles)}mi` : " · statewide"} · target {selected.discovery_target_count ?? 35} verified contacts · {selected.search_language === "es" ? "Spanish" : "English"} · {leads.length} leads · <span className={statusPill(selected.status)}>{selected.status}</span></p>}

        {!selected && canManage && (
          <>
            <div className="field" style={{ maxWidth: 360 }}>
              <label>Name</label>
              <input value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="Dallas Metro 50mi" />
            </div>
            <div className="field" style={{ maxWidth: 360 }}>
              <label>Area type</label>
              <select value={createGeographyType} onChange={(event) => setCreateGeographyType(event.target.value as "radius" | "state")}>
                <option value="radius">Around a location</option>
                <option value="state">Entire state</option>
              </select>
            </div>
            {createGeographyType === "state" && (
              <div className="field" style={{ maxWidth: 360 }}>
                <label>State</label>
                <select value={createStateCode} onChange={(event) => setCreateStateCode(event.target.value)}>
                  {US_STATES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                </select>
              </div>
            )}
            <div className="field" style={{ maxWidth: 360 }}>
              <label>Discovery language</label>
              <select value={createLanguage} onChange={(event) => setCreateLanguage(event.target.value as "en" | "es")}>
                <option value="en">English</option>
                <option value="es">Spanish (español)</option>
              </select>
              {createLanguage === "es" && <span className="hint">Seeds from a Spanish-speaking-church directory and only returns churches with a public Spanish-language service or Hispanic ministry.</span>}
            </div>
            <DenominationPicker value={createDenominations} onChange={setCreateDenominations} />
          </>
        )}

        {selected && canManage && (
          <DenominationPicker value={denominationDraft} onChange={setDenominationDraft} disabled={!!discoveryRun} />
        )}
        {selected && canManage && (
          <div className="field" style={{ maxWidth: 240, marginTop: 8 }}>
            <label>Discovery language</label>
            <select value={selected.search_language} disabled={busy === "save-language"}
              onChange={(e) => changeLanguage(e.target.value as "en" | "es")}>
              <option value="en">English</option>
              <option value="es">Spanish (español)</option>
            </select>
            <span className="hint">Applies to the next discovery round.</span>
          </div>
        )}
        {selected && discoveryRun && <p className="hint">Denomination targeting is locked after discovery begins so one campaign cannot mix targeting rules.</p>}

        {(selected?.geography_type !== "state" && (!selected ? createGeographyType === "radius" : true)) && <div style={{ marginTop: 10 }}>
          <CampaignMap
            key={selected?.id ?? "new"}
            editable={canManage}
            initialCenter={selected && selected.center_lat != null && selected.center_lng != null ? { lat: selected.center_lat, lng: selected.center_lng } : null}
            initialRadiusMiles={selected ? Number(selected.radius_miles) : 50}
            leads={selected ? toMapLeads(leads) : undefined}
            onChange={selected ? (canManage ? setDetailDraft : undefined) : (canManage ? setCreateDraft : undefined)}
          />
        </div>}

        {!selected && canManage && (
          <div style={{ marginTop: 10 }}>
            <button className="btn btn-primary" disabled={busy === "create"} onClick={createCampaign}>
              {busy === "create" ? "Creating…" : "Create campaign"}</button>
            <span className="hint" style={{ marginLeft: 10 }}>{createGeographyType === "state" ? "Discovery will cover the selected state." : "Click the map, drag the pin, or search a place to set the center; the slider sets the radius."}</span>
          </div>
        )}
        {selected && canManage && (detailDraft || (!discoveryRun && denominationDraft.join(',') !== (selected.denomination_filter ?? []).join(','))) && (
          <button className="btn btn-primary" style={{ marginTop: 8 }} disabled={busy === "save-center"} onClick={saveTargeting}>
            {busy === "save-center" ? "Saving…" : "Save targeting"}</button>
        )}
      </div>

      {/* Steps 2–5 apply to a selected campaign. Order is guidance only, not a
          hard lock — every action stays available whenever it is valid. */}
      {selected && (
        <>
          {/* STEP 2 — Discover */}
          <div className="card">
            <h3>2 · Discover</h3>
            <p className="muted">Search the selected denominations' official directories first, then confirm the public general email and active youth ministry on congregation-owned pages. General web search is used only when no denomination is selected. Discovered leads land staged (found, not yet in the send pipeline) and are auto-verified.</p>
            {selected.search_language === "es" && <p className="hint">Spanish campaign: discovery seeds from the Spanish-speaking-church directory and only returns churches with a public Spanish-language service or Hispanic ministry.</p>}
            <p className="hint">Size is checked against the live <a href="https://outreach100.com/largest-churches-in-america" target="_blank" rel="noreferrer">Outreach 100</a> profiles. <a href="https://hirr.hartfordinternational.edu/research/megachurch-database/" target="_blank" rel="noreferrer">Hartford's Megachurch Database</a> is linked for research only and is not copied into IGY under its published use restriction.</p>
            {discoveryRun && <p className="hint" role="status">
              {discoveryRun.status === "completed"
                ? (discoveryRun.last_error ? "Discovery complete with saved partial results" : "Discovery complete")
                : discoveryRun.status === "failed" ? "Discovery failed" : "Discovery in progress"}: round {discoveryRun.round_count} of {discoveryRun.max_rounds} · found {discoveryRun.found_count} · saved {discoveryRun.inserted_count} · already known/skipped {discoveryRun.skipped_count} · outside target area {discoveryRun.out_of_radius_count}
            </p>}
            {canManage && (
              <button className="btn btn-primary" disabled={busy === "discover"} onClick={runDiscovery}>
                {busy === "discover" ? "Discovering…" : "Run discovery"}</button>
            )}
          </div>

          {/* STEP 3 — Review leads (verification reasons inline) */}
          <div className="card">
            <h3>3 · Review leads</h3>
            <div className="row" style={{ margin: "6px 0", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
              <div className="field" style={{ margin: 0 }}><label>Filter by size</label>
                <select value={viewBucket} onChange={(e) => setViewBucket(e.target.value as "all" | SizeBucket)}>
                  <option value="all">All sizes</option>
                  {BUCKETS.map((b) => <option key={b} value={b}>{BUCKET_LABEL[b]}</option>)}
                </select>
              </div>
              {canManage && (
                <button className="btn btn-ghost" disabled={busy === "verify"} onClick={verifyLeadsRun}>
                  {busy === "verify" ? "Verifying…" : "Re-verify leads"}</button>
              )}
            </div>
            <div className="sim-scroll">
              <table className="table">
                <thead><tr>
                  <th>Promote</th><th>Release</th><th>Church</th><th>Location</th><th>Size</th><th>Attendance</th><th>Confidence</th><th>Status</th><th>Verified</th><th>Sends</th>
                </tr></thead>
                <tbody>
                  {shown.length === 0 && <tr><td colSpan={10} className="muted">No leads{viewBucket !== "all" ? " in this size bucket" : ""}.</td></tr>}
                  {shown.map((l) => {
                    const reason = (l.verification_status !== "passed" && l.verification_status !== "manual_override")
                      ? verificationReason(l.verification_notes) : null;
                    return (
                      <tr key={l.id}>
                        <td><input type="checkbox" aria-label={`Promote ${l.org_name}`} disabled={!promotable(l)}
                          checked={promoteSel.has(l.id)} onChange={(e) => setPromoteSel((current) => {
                            const next = new Set(current); if (e.target.checked) next.add(l.id); else next.delete(l.id); return next;
                          })} /></td>
                        <td><input type="checkbox" aria-label={`Release to ${l.org_name}`} disabled={!releasable(l)}
                          checked={audienceSel.has(l.id)} onChange={(e) => setAudienceSel((current) => {
                            const next = new Set(current); if (e.target.checked) next.add(l.id); else next.delete(l.id); return next;
                          })} /></td>
                        <td>
                          {l.website ? <a href={l.website} target="_blank" rel="noreferrer">{l.org_name}</a> : l.org_name}
                          <div className="muted" style={{ fontSize: 12 }}>{l.contact_email}</div>
                          {canOverride && contactEdit?.leadId !== l.id && (
                            <button className="btn btn-ghost" style={{ marginTop: 4, padding: "2px 6px", fontSize: 11 }}
                              onClick={() => setContactEdit({ leadId: l.id, email: l.contact_email, sourceUrl: l.website ?? "", manuallyConfirmed: false })}>
                              Update public email
                            </button>
                          )}
                          {canOverride && contactEdit?.leadId === l.id && (
                            <div style={{ display: "grid", gap: 6, marginTop: 7, minWidth: 240 }}>
                              <label style={{ fontSize: 11 }}>Public general or office email
                                <input type="email" value={contactEdit.email} onChange={(event) => setContactEdit({ ...contactEdit, email: event.target.value })} />
                              </label>
                              <label style={{ fontSize: 11 }}>Church webpage showing that email
                                <input type="url" value={contactEdit.sourceUrl} placeholder="https://church.org/contact" onChange={(event) => setContactEdit({ ...contactEdit, sourceUrl: event.target.value })} />
                              </label>
                              <label style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: 11 }}>
                                <input type="checkbox" checked={contactEdit.manuallyConfirmed} onChange={(event) => setContactEdit({ ...contactEdit, manuallyConfirmed: event.target.checked })} />
                                I personally confirmed this general inbox on the linked church page.
                              </label>
                              <div style={{ display: "flex", gap: 6 }}>
                                <button className="btn btn-primary" style={{ padding: "3px 7px", fontSize: 11 }}
                                  disabled={busy === `contact:${l.id}` || !contactEdit.email.trim() || !contactEdit.sourceUrl.trim() || !contactEdit.manuallyConfirmed} onClick={updateContactEmail}>
                                  {busy === `contact:${l.id}` ? "Checking…" : "Verify and update"}
                                </button>
                                <button className="btn btn-ghost" style={{ padding: "3px 7px", fontSize: 11 }} onClick={() => setContactEdit(null)}>Cancel</button>
                              </div>
                              <span className="hint">The replacement is re-verified. If the page blocks the automated check, it remains needs_manual until you use Override.</span>
                            </div>
                          )}
                        </td>
                        <td>{[l.city, l.state].filter(Boolean).join(", ") || "—"}</td>
                        <td><span className="pill">{l.size_bucket}</span></td>
                        <td>{l.estimated_attendance != null
                          ? (l.attendance_source_url
                            ? <span><a href={l.attendance_source_url} target="_blank" rel="noreferrer">{l.estimated_attendance.toLocaleString()}</a><span className="muted" style={{ display: "block", fontSize: 10 }}>{attendanceSourceName(l.attendance_source_url)}</span></span>
                            : l.estimated_attendance.toLocaleString())
                          : <span className="muted">unknown</span>}</td>
                        <td>{l.discovery_confidence ?? "—"}</td>
                        <td><span className={statusPill(l.status)}>{l.status}</span></td>
                        <td>
                          <span className={verifyPill(l.verification_status)}>{l.verification_status}</span>
                          {canOverride && l.verification_status !== "passed" && l.verification_status !== "manual_override" && (
                            <button className="btn btn-ghost" style={{ marginLeft: 6, padding: "2px 6px", fontSize: 11 }}
                              disabled={busy === `override:${l.id}`} onClick={() => overrideVerification(l.id)}
                              title="Mark this lead manually verified so it can send (requires the override permission)">
                              {busy === `override:${l.id}` ? "…" : "Override"}</button>
                          )}
                          {reason && <div className="muted" style={{ fontSize: 11, marginTop: 2, maxWidth: 320 }}>{reason}</div>}
                        </td>
                        <td>{l.send_count}{l.promo_code ? <div className="mono" style={{ fontSize: 11 }}>{l.promo_code}</div> : null}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* STEP 4 — Set offer + promote (merged) */}
          {canManage && (
            <div className="card">
              <h3>4 · Set offer + promote</h3>
              {offerDraft && (
                <div style={{ margin: "6px 0", padding: "10px 12px", background: "#fff8ec", borderRadius: 8 }}>
                  <strong style={{ fontSize: 13 }}>Offer</strong>
                  <div className="row" style={{ gap: 12, margin: "8px 0", alignItems: "flex-end", flexWrap: "wrap" }}>
                    <div className="field" style={{ margin: 0 }}>
                      <label>Discount %</label>
                      <input type="number" min={1} max={100} style={{ width: 90 }} value={offerDraft.discount_percent}
                        onChange={(e) => setOfferDraft((o) => o && { ...o, discount_percent: e.target.value })} />
                    </div>
                    <div className="field" style={{ margin: 0 }}>
                      <label>Message variant</label>
                      <select value={offerDraft.message_variant}
                        onChange={(e) => setOfferDraft((o) => o && { ...o, message_variant: e.target.value })}>
                        {MESSAGE_VARIANTS.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
                      </select>
                    </div>
                    <button className="btn btn-primary" disabled={busy === "save-offer"} onClick={saveOffer}>
                      {busy === "save-offer" ? "Saving…" : "Save offer"}</button>
                  </div>
                  <p className="hint" style={{ margin: 0 }}>The discount templates only the numeral into the approved copy (&ldquo;{offerDraft.discount_percent || "N"}% off&rdquo;). New copy variants require copy + legal approval.</p>
                </div>
              )}
              <div style={{ margin: "6px 0", padding: "10px 12px", background: "#f6faff", borderRadius: 8 }}>
                <strong style={{ fontSize: 13 }}>Promote exact staged leads → active (enters send pipeline)</strong>
                <div className="row" style={{ gap: 8, margin: "8px 0", flexWrap: "wrap" }}>
                  <button className="btn btn-ghost" disabled={shownPromotable.length === 0} onClick={() => setPromoteSel((current) => {
                    const next = new Set(current); shownPromotable.forEach((lead) => next.add(lead.id)); return next;
                  })}>Select eligible shown ({shownPromotable.length})</button>
                  <button className="btn btn-ghost" disabled={promoteSel.size === 0} onClick={() => setPromoteSel(new Set())}>Clear selection</button>
                </div>
                <p className="hint">Selected {promoteSel.size}. Only freshly verified staged leads can be selected, and the server independently enforces the same gate.</p>
                <button className="btn btn-primary" disabled={promoteSel.size === 0 || busy === "promote"} onClick={promote}>
                  {busy === "promote" ? "Promoting…" : `Promote selected (${promoteSel.size})`}</button>
              </div>
            </div>
          )}

          {/* STEP 5 — Preview + schedule */}
          {canManage && (
            <div className="card">
              <h3>5 · Preview + schedule</h3>
              <div className="row" style={{ gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                <button className="btn btn-ghost" disabled={shownReleasable.length === 0} onClick={() => setAudienceSel((current) => {
                  const next = new Set(current); shownReleasable.forEach((lead) => next.add(lead.id)); return next;
                })}>Select active shown ({shownReleasable.length})</button>
                <button className="btn btn-ghost" disabled={audienceSel.size === 0} onClick={() => setAudienceSel(new Set())}>Clear release selection</button>
                <span className="hint">Exact release audience: {audienceSel.size}</span>
              </div>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <button className="btn btn-ghost" disabled={!!busy || audienceSel.size === 0} onClick={() => send(false)}>
                  {busy === "send-dry" ? "Previewing…" : "Preview send (dry-run)"}</button>
              </div>
              <div style={{ marginTop: 14, padding: "12px", borderRadius: 8, background: "#f6faff" }}>
                <div className="row" style={{ gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Release date and time</label>
                    <input type="datetime-local" value={releaseDraft} onChange={(e) => setReleaseDraft(e.target.value)} />
                    <small className="hint" style={{ display: "block", marginTop: 4, maxWidth: 340 }}>
                      Schedule time, not exact send time. The campaign becomes eligible at this moment and goes out on the next 15-minute release sweep, so up to about 15 minutes later.
                    </small>
                  </div>
                  <button className="btn btn-primary" disabled={!releaseDraft || audienceSel.size === 0 || !!busy} onClick={scheduleRelease}>
                    {busy === "schedule" ? "Scheduling…" : selected.status === "scheduled" ? "Reschedule campaign" : "Approve and schedule"}
                  </button>
                  {selected.status === "scheduled" && <button className="btn btn-ghost" disabled={!!busy} onClick={pauseRelease}>{busy === "pause" ? "Pausing…" : "Pause release"}</button>}
                </div>
                {selected.release_at && <p className="hint" style={{ marginBottom: 0 }}>
                  <strong>{selected.status === "scheduled" ? "Next release" : "Last scheduled release"}:</strong> {new Date(selected.release_at).toLocaleString()} ({selected.release_timezone || "timezone not recorded"})
                  {selected.schedule_snapshot?.recipient_count != null ? ` · ${selected.schedule_snapshot.recipient_count} approved recipients` : ""}
                </p>}
              </div>
              <p className="hint" style={{ marginTop: 8 }}>
                Scheduling records the exact verified, promoted audience, approved template, offer, date, time, timezone, and approver. The frequent worker releases only due scheduled campaigns. The three server approval flags remain the emergency master gate; when closed, a due campaign stays scheduled and no mail is sent.
              </p>

              {report && (
                <div className="card" style={{ marginTop: 14 }}>
                  <strong>Send {report.mode === "live" ? "result (LIVE)" : "preview (dry-run)"}</strong>
                  {report.gate_reasons.length > 0 && <p className="hint">Gate closed → stayed dry-run: {report.gate_reasons.join("; ")}</p>}
                  <p className="muted" style={{ fontSize: 13 }}>
                    scanned {report.scanned} · {report.mode === "live" ? `sent ${report.sent}` : `would send ${report.would_send}`} · not due {report.not_due} · complete {report.complete} · unverified {report.skipped_unverified} · skipped {report.skipped} · errors {report.errors}
                  </p>
                  <div className="sim-scroll">
                    <table className="table"><thead><tr><th>Church</th><th>To</th><th>Touch</th><th>Outcome</th><th>Code</th></tr></thead>
                      <tbody>{report.items.filter((i) => i.outcome === "would_send" || i.outcome === "sent").map((i, n) => (
                        <tr key={n}><td>{i.org_name}</td><td>{i.to}</td><td>{i.touch}</td><td>{i.outcome}</td><td className="mono">{i.promo_code || "—"}</td></tr>
                      ))}</tbody>
                    </table>
                  </div>
                </div>
              )}
              <div className="card" style={{ marginTop: 14 }}>
                <strong>Delivery tracking</strong>
                <p className="muted" style={{ fontSize: 13 }}>
                  accepted {deliveries.filter((d) => Boolean(d.sent_at)).length} · delivered {deliveries.filter((d) => d.status === "delivered").length} · delayed {deliveries.filter((d) => d.status === "delayed").length} · bounced {deliveries.filter((d) => d.status === "bounced").length} · complained {deliveries.filter((d) => d.status === "complained").length} · suppressed {deliveries.filter((d) => d.status === "suppressed").length} · failed {deliveries.filter((d) => d.status === "failed").length}
                </p>
                <div className="sim-scroll">
                  <table className="table"><thead><tr><th>Church</th><th>To</th><th>Touch</th><th>Provider status</th><th>Updated</th><th>Message ID</th></tr></thead>
                    <tbody>
                      {deliveries.length === 0 && <tr><td colSpan={6} className="muted">No tracked deliveries for this campaign.</td></tr>}
                      {deliveries.map((delivery) => {
                        const lead = leads.find((item) => item.id === delivery.lead_id);
                        return <tr key={delivery.id}>
                          <td>{lead?.org_name ?? "Unknown"}</td><td>{lead?.contact_email ?? "Unknown"}</td><td>{delivery.touch}</td>
                          <td><span className={deliveryStatusPill(delivery.status)}>{delivery.status}</span>{delivery.error ? <div className="muted" style={{ fontSize: 11 }}>{delivery.error}</div> : null}</td>
                          <td>{delivery.last_event_at || delivery.delivered_at || delivery.sent_at ? new Date(delivery.last_event_at || delivery.delivered_at || delivery.sent_at || "").toLocaleString() : "—"}</td>
                          <td className="mono" style={{ fontSize: 11 }}>{delivery.provider_message_id ?? "—"}</td>
                        </tr>;
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="hint">Accepted means Resend accepted the API request. Delivered means Resend confirmed delivery to the recipient mail server.</p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
