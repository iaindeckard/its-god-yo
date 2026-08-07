"use client";

import { useEffect, useRef, useState } from "react";
import type * as LT from "leaflet";
import "leaflet/dist/leaflet.css";

// Tile source: OSM raster by default, env-overridable to a keyed provider
// (MapTiler/Stadia) without a code change — same swappable ethos as lib/geocode.ts.
const TILE_URL = process.env.NEXT_PUBLIC_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTR = process.env.NEXT_PUBLIC_MAP_ATTRIBUTION || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const IGY_BLUE = "#378ADD";
const MILES_TO_M = 1609.34;

// North America starting frame (drill-down region -> state -> street is normal zoom/pan).
const NA_BOUNDS: [[number, number], [number, number]] = [[15, -130], [55, -55]];

export type MapSizeBucket = "small" | "medium" | "large" | "mega" | "unknown";
const BUCKET_COLOR: Record<MapSizeBucket, string> = {
  small: "#9dc3ec", medium: "#378ADD", large: "#1f5f9e", mega: "#E8A200", unknown: "#9aa7b5",
};

export interface MapLead {
  id: string; org_name: string; status: string;
  latitude: number | null; longitude: number | null; size_bucket: string;
}
export interface CampaignMapChange {
  center_lat: number; center_lng: number; radius_miles: number; center_label?: string;
}
interface CampaignMapProps {
  editable: boolean;
  initialCenter?: { lat: number; lng: number } | null;
  initialRadiusMiles: number;
  leads?: MapLead[];
  onChange?: (v: CampaignMapChange) => void;
}

export default function CampaignMap({ editable, initialCenter, initialRadiusMiles, leads, onChange }: CampaignMapProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const LRef = useRef<typeof LT | null>(null);
  const mapRef = useRef<LT.Map | null>(null);
  const circleRef = useRef<LT.Circle | null>(null);
  const markerRef = useRef<LT.Marker | null>(null);
  const leadLayerRef = useRef<LT.LayerGroup | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const revTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(initialCenter ?? null);
  const [radius, setRadius] = useState<number>(initialRadiusMiles);
  const [label, setLabel] = useState<string>("");
  const [searchQ, setSearchQ] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [searching, setSearching] = useState(false);

  // Emit a change to the parent (coords + radius + best-known label).
  function emit(next: { lat: number; lng: number }, r: number, lbl?: string) {
    onChangeRef.current?.({ center_lat: next.lat, center_lng: next.lng, radius_miles: r, center_label: lbl });
  }

  // Debounced reverse-geocode so a dragged/clicked pin fills a human label.
  function reverseLabel(lat: number, lng: number, r: number) {
    if (revTimer.current) clearTimeout(revTimer.current);
    revTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/geocode?lat=${lat}&lng=${lng}`);
        const data = await res.json();
        if (res.ok && data.label) { setLabel(data.label); emit({ lat, lng }, r, data.label); }
      } catch { /* best-effort */ }
    }, 600);
  }

  // Init the map once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mod = await import("leaflet");
        const L = ((mod as unknown as { default?: typeof LT }).default ?? (mod as unknown as typeof LT));
        if (cancelled || !mountRef.current) return;
        LRef.current = L;
        const map = L.map(mountRef.current, { minZoom: 3, worldCopyJump: true });
        L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 19 }).addTo(map);
        if (initialCenter) map.setView([initialCenter.lat, initialCenter.lng], 9);
        else map.fitBounds(NA_BOUNDS);
        leadLayerRef.current = L.layerGroup().addTo(map);
        mapRef.current = map;

        if (editable) {
          map.on("click", (e: LT.LeafletMouseEvent) => {
            const c = { lat: e.latlng.lat, lng: e.latlng.lng };
            setCenter(c);
            reverseLabel(c.lat, c.lng, radius);
          });
        }
        setStatus("ready");
        // A ResizeObserver keeps the map sized to its container (it renders 0px
        // if the container was hidden/resized at init).
        const ro = new ResizeObserver(() => map.invalidateSize());
        ro.observe(mountRef.current);
        (map as unknown as { _igyRo?: ResizeObserver })._igyRo = ro;
      } catch (e) {
        if (!cancelled) { setStatus("error"); console.error("[campaign-map] init failed", e instanceof Error ? e.message : e); }
      }
    })();
    return () => {
      cancelled = true;
      if (revTimer.current) clearTimeout(revTimer.current);
      const map = mapRef.current as (LT.Map & { _igyRo?: ResizeObserver }) | null;
      map?._igyRo?.disconnect();
      map?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reflect center + radius onto the circle/marker, and emit.
  useEffect(() => {
    const L = LRef.current, map = mapRef.current;
    if (!L || !map || !center) return;
    const rMeters = radius * MILES_TO_M;
    if (!circleRef.current) {
      circleRef.current = L.circle([center.lat, center.lng], { radius: rMeters, color: IGY_BLUE, weight: 2, fillColor: IGY_BLUE, fillOpacity: 0.08 }).addTo(map);
    } else {
      circleRef.current.setLatLng([center.lat, center.lng]).setRadius(rMeters);
    }
    if (editable) {
      const icon = L.divIcon({
        className: "",
        html: `<div style="width:16px;height:16px;border-radius:50%;background:${IGY_BLUE};border:3px solid #fff;box-shadow:0 1px 4px rgba(4,44,83,.5);"></div>`,
        iconSize: [16, 16], iconAnchor: [8, 8],
      });
      if (!markerRef.current) {
        markerRef.current = L.marker([center.lat, center.lng], { draggable: true, icon }).addTo(map);
        markerRef.current.on("dragend", () => {
          const p = markerRef.current!.getLatLng();
          const c = { lat: p.lat, lng: p.lng };
          setCenter(c);
          reverseLabel(c.lat, c.lng, radius);
        });
      } else {
        markerRef.current.setLatLng([center.lat, center.lng]);
      }
    }
    try { map.fitBounds(circleRef.current.getBounds(), { maxZoom: 12 }); } catch { /* noop */ }
    emit(center, radius, label || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center, radius]);

  // Plot leads as size-colored dots whenever the set changes.
  useEffect(() => {
    const L = LRef.current, layer = leadLayerRef.current;
    if (!L || !layer) return;
    layer.clearLayers();
    for (const l of leads ?? []) {
      if (l.latitude == null || l.longitude == null) continue;
      const color = BUCKET_COLOR[(l.size_bucket as MapSizeBucket)] ?? BUCKET_COLOR.unknown;
      L.circleMarker([l.latitude, l.longitude], { radius: 6, color: "#fff", weight: 1.5, fillColor: color, fillOpacity: 0.95 })
        .bindTooltip(`${l.org_name} · ${l.size_bucket} · ${l.status}`)
        .addTo(layer);
    }
  }, [leads]);

  async function runSearch() {
    if (!searchQ.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/admin/geocode?q=${encodeURIComponent(searchQ.trim())}`);
      const data = await res.json();
      if (res.ok && data.lat != null && data.lng != null) {
        const c = { lat: data.lat, lng: data.lng };
        mapRef.current?.setView([c.lat, c.lng], 10);
        if (editable) { setCenter(c); setLabel(searchQ.trim()); emit(c, radius, searchQ.trim()); }
      }
    } catch { /* best-effort */ }
    finally { setSearching(false); }
  }

  const hasLeadPins = (leads ?? []).some((l) => l.latitude != null && l.longitude != null);

  return (
    <div>
      {editable && (
        <div className="row" style={{ gap: 8, marginBottom: 8, alignItems: "flex-end" }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Find a place</label>
            <input value={searchQ} onChange={(e) => setSearchQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); runSearch(); } }}
              placeholder="Dallas, TX" />
          </div>
          <button type="button" className="btn btn-ghost" disabled={searching} onClick={runSearch}>
            {searching ? "Searching…" : "Search"}</button>
        </div>
      )}

      <div style={{ position: "relative", borderRadius: 12, overflow: "hidden", border: "1px solid rgba(4,44,83,0.12)" }}>
        <div ref={mountRef} style={{ width: "100%", height: 420 }} />
        {status !== "ready" && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#3E5B80", fontSize: 14, background: "#eef4fb", pointerEvents: "none" }}>
            {status === "loading" ? "Loading map…" : "Map couldn’t load."}
          </div>
        )}
      </div>

      {editable && (
        <div className="row" style={{ gap: 12, marginTop: 10, alignItems: "center" }}>
          <label style={{ fontSize: 13, whiteSpace: "nowrap" }}>Radius: <strong>{radius} mi</strong></label>
          <input type="range" min={1} max={250} value={radius} style={{ flex: 1 }}
            onChange={(e) => setRadius(Number(e.target.value))} />
          <span className="muted" style={{ fontSize: 12 }}>{center ? `${center.lat.toFixed(3)}, ${center.lng.toFixed(3)}` : "click the map to set a center"}</span>
        </div>
      )}
      {editable && label && <p className="hint">Center: {label}</p>}

      {hasLeadPins && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8, fontSize: 12 }}>
          {(["small", "medium", "large", "mega", "unknown"] as MapSizeBucket[]).map((b) => (
            <span key={b} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: BUCKET_COLOR[b], border: "1px solid #fff", boxShadow: "0 0 0 1px rgba(0,0,0,.1)" }} />{b}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
