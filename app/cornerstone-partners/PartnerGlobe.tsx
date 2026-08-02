"use client";

import { useEffect, useRef, useState } from "react";
import type { GlobePoint } from "@/lib/cornerstone";

// The globe base is a "school atlas" raster (Natural Earth cross-blended hypsometric
// tints + shaded relief + water + drainages), vendored to /public. The IGY-brand
// accents (locked palette per IGY-Brand-Identity-Mark-LOCKED-2026-07-27) layer ON TOP:
// primary blue #378ADD for country-border outlines, the atmosphere glow and the tooltip
// accent; dark navy #042C53 partner pins with an enlarged IGY-blue hover. Brass-gold
// stays reserved for the "God," wordmark shadow and is not used here.
const ATLAS_TEXTURE = "/cornerstone/earth-hypso.webp"; // vendored, same-origin (no CDN)
const BORDER = "#378ADD";       // country-border outlines over the atlas — locked primary blue
const IGY_BLUE = "#378ADD";     // atmosphere glow + tooltip accent
const POINT = "#042C53";        // partner pin — locked dark navy, reads over the atlas colors
const POINT_DIM = "rgba(4,44,83,0.4)"; // approx pin: dimmer/translucent so a country-
// centroid blob never reads as a precise church pin.
const POINT_HOVER = "#378ADD";  // hovered pin — IGY blue + enlarged
const PANEL_A = "#EAF3FC", PANEL_B = "#F6FAFE"; // light container gradient framing the atlas globe

// A church we couldn't geocode is plotted at its country's centroid (approx=true).
// It must NOT look like a precisely-located pin: crisp + solid = exact; smaller +
// translucent = approximate. Hover always wins (blue + enlarged), for either kind.
const isApprox = (d: object) => (d as GlobePoint).approx === true;
const colorFor = (d: object, hovered: GlobePoint | null) =>
  d === hovered ? POINT_HOVER : isApprox(d) ? POINT_DIM : POINT;
const radiusFor = (d: object, hovered: GlobePoint | null) =>
  d === hovered ? 0.6 : isApprox(d) ? 0.3 : 0.42;

/**
 * 3D partner globe. Reuses USN's GlobeModal approach (globe.gl + three) but the
 * library is BUNDLED (dynamic import from node_modules) — NOT loaded from a CDN.
 * The globe surface is a vendored "school atlas" raster (Natural Earth cross-blended
 * hypsometric tints + shaded relief + water + drainages) served from our own /public
 * as globeImageUrl — same-origin, no CDN. IGY-blue country-border outlines (from the
 * vendored 110m GeoJSON) layer crisply ON TOP of the atlas, alongside the atmosphere
 * glow and partner pins. On point hover the auto-rotation pauses so the tooltip
 * attaches to a stationary point. The flat list below is the fallback when WebGL/the
 * globe isn't available. Point data carries only the same safe fields shown in the list.
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
    let resumeTimer: ReturnType<typeof setTimeout> | null = null;

    (async () => {
      try {
        const { default: Globe } = await import("globe.gl");
        const el = mountRef.current;
        if (cancelled || !el) return;

        const world = new Globe(el)
          .backgroundColor("rgba(0,0,0,0)")
          .globeImageUrl(ATLAS_TEXTURE) // vendored school-atlas raster (same-origin)
          .showAtmosphere(true)
          .atmosphereColor(IGY_BLUE)
          .atmosphereAltitude(0.18)
          .pointsData(points as unknown as object[])
          .pointLat("lat")
          .pointLng("lng")
          .pointAltitude(0.02)
          .pointRadius((d: object) => radiusFor(d, hovered))
          .pointsMerge(false)
          .pointColor((d: object) => colorFor(d, hovered));

        // Keep the material untinted (white) so the atlas texture shows its true natural
        // colors, and as a light placeholder before the texture finishes loading.
        try { (world.globeMaterial() as { color?: { set: (c: string) => void } }).color?.set("#ffffff"); } catch { /* noop */ }

        const controls = world.controls() as { autoRotate: boolean; autoRotateSpeed: number; enableZoom: boolean };
        controls.autoRotate = true;
        controls.autoRotateSpeed = 0.5;
        controls.enableZoom = true;
        world.pointOfView({ lat: 25, lng: -75, altitude: 2.3 }); // Americas-forward (partners skew US)

        // Hover: pause auto-rotation so the globe holds still and the tooltip attaches
        // to a stationary point; resume rotation on hover-out. The resume is debounced
        // (~180ms) so a single-frame raycast miss at the point's edge can't restart the
        // rotation mid-hover — the tooltip stays reliably attached without the user
        // chasing a moving target.
        const paint = () => world
          .pointColor((d: object) => colorFor(d, hovered))
          .pointRadius((d: object) => radiusFor(d, hovered)); // refresh colors + sizes
        world.onPointHover((pt: object | null, coords?: unknown) => {
          const next = (pt as GlobePoint) ?? null;
          if (next) {
            // Entering / staying on a point: hold rotation and the tooltip immediately.
            if (resumeTimer) { clearTimeout(resumeTimer); resumeTimer = null; }
            hovered = next;
            controls.autoRotate = false;
            paint();
            setHover(next);
          } else if (!resumeTimer) {
            // Leaving a point: debounce the clear so a single-frame raycast miss at the
            // point's edge doesn't drop the tooltip or restart rotation mid-hover. Both
            // the tooltip and auto-rotation resume together after a genuine hover-out.
            resumeTimer = setTimeout(() => {
              resumeTimer = null;
              hovered = null;
              controls.autoRotate = true;
              paint();
              setHover(null);
            }, 180);
          }
          void coords;
        });

        // IGY-blue country-border outlines layered ON TOP of the atlas texture —
        // vendored Natural Earth 110m polygons from our own /public (same-origin, no CDN).
        // Transparent fill so the atlas colors show through; only the stroke renders.
        // Best-effort: if it fails the globe still works, just without borders.
        fetch("/cornerstone/countries-110m.geojson")
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`geojson ${r.status}`))))
          .then((geo: { features: object[] }) => {
            if (cancelled) return;
            world
              .polygonsData(geo.features)
              .polygonCapColor(() => "rgba(0,0,0,0)")   // transparent — let the atlas show through
              .polygonSideColor(() => "rgba(0,0,0,0)")
              .polygonStrokeColor(() => BORDER)          // crisp IGY-blue borders on top of the atlas
              .polygonAltitude(0.004)
              .polygonsTransitionDuration(0);
          })
          .catch((e) => console.error("[partner-globe] country outlines failed (globe still works):", e instanceof Error ? e.message : e));

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
      if (resumeTimer) { clearTimeout(resumeTimer); resumeTimer = null; }
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
      style={{ position: "relative", background: `linear-gradient(180deg, ${PANEL_A}, ${PANEL_B})`, borderRadius: 16, overflow: "hidden", border: "1px solid rgba(4,44,83,0.10)", marginBottom: 28 }}
      onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY })}
    >
      <div ref={mountRef} style={{ width: "100%", minHeight: 360 }} aria-hidden="true" />
      {status !== "ready" && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#3E5B80", fontSize: 14, pointerEvents: "none", textAlign: "center", padding: 24 }}>
          {status === "loading" ? "Loading the partner globe…" : "Interactive globe isn’t available on this device. See the full list below."}
        </div>
      )}
      {status === "ready" && (
        <div style={{ position: "absolute", bottom: 10, right: 14, fontSize: 11, color: "rgba(4,44,83,0.45)", pointerEvents: "none" }}>
          Drag to rotate · hover a point
        </div>
      )}
      {status === "ready" && hasApprox && (
        // Only shown when at least one church is plotted at a country centroid, so
        // viewers understand the two marker styles rather than reading every dot as exact.
        <div style={{ position: "absolute", bottom: 10, left: 14, fontSize: 11, color: "rgba(4,44,83,0.6)", pointerEvents: "none", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: POINT, display: "inline-block" }} /> exact
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: POINT_DIM, display: "inline-block", marginLeft: 6 }} /> approximate (country)
        </div>
      )}
      {hover && (
        <div style={{ position: "fixed", zIndex: 50, left: tip.x + 16, top: tip.y - 60, pointerEvents: "none", background: "#FFFFFF", border: `1px solid rgba(55,138,221,0.4)`, borderRadius: 10, padding: "9px 12px", color: "#042C53", fontSize: 13, maxWidth: 240, boxShadow: "0 6px 20px rgba(4,44,83,0.18)" }}>
          <div style={{ fontWeight: 700 }}>{hover.churchName}</div>
          {(loc || hover.country) && <div style={{ color: "#5B7699", fontSize: 12 }}>{[loc, hover.country].filter(Boolean).join(" · ")}</div>}
          <div style={{ color: IGY_BLUE, fontSize: 12, marginTop: 3, fontWeight: 600 }}>Cornerstone Partner #{hover.partnerNumber} · Joined {hover.yearJoined}</div>
          {hover.approx && (
            <div style={{ color: "#8098B5", fontSize: 11, marginTop: 4, fontStyle: "italic" }}>
              Approximate location, plotted at the country&rsquo;s center
            </div>
          )}
        </div>
      )}
    </div>
  );
}
