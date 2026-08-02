"use client";

import { useEffect, useRef, useState } from "react";
import type { GlobePoint } from "@/lib/cornerstone";

// Locked IGY brand values: navy background/globe, IGY blue (the brand mark's
// message-bubble blue) for points, gold for hover highlight.
const NAVY = "#0B1830";
const GLOBE_NAVY = "#152847"; // a touch lighter than the bg so the sphere reads
const IGY_BLUE = "#378ADD";
const IGY_BLUE_DIM = "rgba(55,138,221,0.4)"; // approx points: dimmer/translucent so
// a country-centroid blob never reads as a precise church pin.
const GOLD = "#FFDC52";

// A church we couldn't geocode is plotted at its country's centroid (approx=true).
// It must NOT look like a precisely-located pin: crisp + solid = exact; smaller +
// translucent = approximate. Hover always wins (gold), for either kind.
const isApprox = (d: object) => (d as GlobePoint).approx === true;
const colorFor = (d: object, hovered: GlobePoint | null) =>
  d === hovered ? GOLD : isApprox(d) ? IGY_BLUE_DIM : IGY_BLUE;
const radiusFor = (d: object) => (isApprox(d) ? 0.3 : 0.42);

/**
 * 3D partner globe. Reuses USN's GlobeModal approach (globe.gl + three) but the
 * library is BUNDLED (dynamic import from node_modules) — NOT loaded from a CDN —
 * so there is no runtime dependency on an external server, and no external earth
 * texture is fetched (solid navy globe, brand-colored). The flat list below is the
 * fallback when WebGL/the globe isn't available. Point data carries only the same
 * safe fields shown in the list.
 */
export default function PartnerGlobe({ points }: { points: GlobePoint[] }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<{ _destructor?: () => void } | null>(null);
  const [hover, setHover] = useState<GlobePoint | null>(null);
  const [tip, setTip] = useState({ x: 0, y: 0 });
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    if (!points.length) return;
    let cancelled = false;
    let hovered: GlobePoint | null = null;

    (async () => {
      try {
        const { default: Globe } = await import("globe.gl");
        const el = mountRef.current;
        if (cancelled || !el) return;

        const world = new Globe(el)
          .backgroundColor("rgba(0,0,0,0)")
          .showAtmosphere(true)
          .atmosphereColor(IGY_BLUE)
          .atmosphereAltitude(0.2)
          .pointsData(points as unknown as object[])
          .pointLat("lat")
          .pointLng("lng")
          .pointAltitude(0.02)
          .pointRadius(radiusFor)
          .pointsMerge(false)
          .pointColor((d: object) => colorFor(d, hovered))
          .onPointHover((pt: object | null, coords?: unknown) => {
            hovered = (pt as GlobePoint) ?? null;
            world.pointColor((d: object) => colorFor(d, hovered)); // refresh colors
            setHover(hovered);
            void coords;
          });

        // Solid navy globe — no external texture download.
        try { (world.globeMaterial() as { color?: { set: (c: string) => void } }).color?.set(GLOBE_NAVY); } catch { /* noop */ }

        const controls = world.controls() as { autoRotate: boolean; autoRotateSpeed: number; enableZoom: boolean };
        controls.autoRotate = true;
        controls.autoRotateSpeed = 0.5;
        controls.enableZoom = true;
        world.pointOfView({ lat: 25, lng: -75, altitude: 2.3 }); // Americas-forward (partners skew US)

        const size = () => {
          const w = el.clientWidth || 640;
          world.width(w).height(Math.min(520, Math.max(360, Math.round(w * 0.62))));
        };
        size();
        const ro = new ResizeObserver(size);
        ro.observe(el);

        globeRef.current = { _destructor: () => { ro.disconnect(); try { (world as { _destructor?: () => void })._destructor?.(); } catch { /* noop */ } } };
        setStatus("ready");
      } catch (e) {
        if (!cancelled) { setStatus("error"); console.error("[partner-globe] init failed", e instanceof Error ? e.message : e); }
      }
    })();

    return () => {
      cancelled = true;
      try { globeRef.current?._destructor?.(); } catch { /* noop */ }
      if (mountRef.current) mountRef.current.innerHTML = "";
      globeRef.current = null;
    };
  }, [points]);

  if (!points.length) return null;

  const loc = hover ? [hover.city, hover.stateProvince].filter(Boolean).join(", ") : "";
  const hasApprox = points.some((p) => p.approx); // gate the "approximate" legend

  return (
    <div
      style={{ position: "relative", background: NAVY, borderRadius: 16, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)", marginBottom: 28 }}
      onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY })}
    >
      <div ref={mountRef} style={{ width: "100%", minHeight: 360 }} aria-hidden="true" />
      {status !== "ready" && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#a9bad6", fontSize: 14, pointerEvents: "none", textAlign: "center", padding: 24 }}>
          {status === "loading" ? "Loading the partner globe…" : "Interactive globe isn’t available on this device — see the full list below."}
        </div>
      )}
      {status === "ready" && (
        <div style={{ position: "absolute", bottom: 10, right: 14, fontSize: 11, color: "rgba(255,255,255,0.35)", pointerEvents: "none" }}>
          Drag to rotate · hover a point
        </div>
      )}
      {status === "ready" && hasApprox && (
        // Only shown when at least one church is plotted at a country centroid, so
        // viewers understand the two marker styles rather than reading every dot as exact.
        <div style={{ position: "absolute", bottom: 10, left: 14, fontSize: 11, color: "rgba(255,255,255,0.5)", pointerEvents: "none", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: IGY_BLUE, display: "inline-block" }} /> exact
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: IGY_BLUE_DIM, display: "inline-block", marginLeft: 6 }} /> approximate (country)
        </div>
      )}
      {hover && (
        <div style={{ position: "fixed", zIndex: 50, left: tip.x + 16, top: tip.y - 60, pointerEvents: "none", background: "#111b30", border: `1px solid ${GOLD}66`, borderRadius: 10, padding: "9px 12px", color: "#fff", fontSize: 13, maxWidth: 240 }}>
          <div style={{ fontWeight: 700 }}>{hover.churchName}</div>
          {(loc || hover.country) && <div style={{ color: "#a9bad6", fontSize: 12 }}>{[loc, hover.country].filter(Boolean).join(" · ")}</div>}
          <div style={{ color: GOLD, fontSize: 12, marginTop: 3 }}>Cornerstone Partner #{hover.partnerNumber} · Joined {hover.yearJoined}</div>
          {hover.approx && (
            <div style={{ color: "#8ea6c8", fontSize: 11, marginTop: 4, fontStyle: "italic" }}>
              Approximate location — plotted at the country&rsquo;s center
            </div>
          )}
        </div>
      )}
    </div>
  );
}
