"use client";

import { useEffect, useRef, useState } from "react";
import type { GlobePoint } from "@/lib/cornerstone";

// The globe base is a "school atlas" raster (Natural Earth cross-blended hypsometric
// tints + shaded relief + water + drainages), vendored to /public. IGY-brand accents
// layer ON TOP: primary blue #378ADD for country-border outlines, the atmosphere glow
// and the tooltip accent. Brass-gold stays reserved for the "God," wordmark shadow.
// 4096x2048 (~538KB webp). Deliberately NOT the 8192-wide original: that exceeded
// common WebGL max-texture / memory limits and failed to upload, leaving the globe
// the flat white placeholder. 4096 is universally supported and keeps lake/bay/
// river-mouth detail while staying page-weight-friendly.
const ATLAS_TEXTURE = "/cornerstone/earth-hypso-4096.webp"; // vendored, same-origin (no CDN)
const BORDER = "#378ADD";       // country-border outlines over the atlas — locked primary blue
const IGY_BLUE = "#378ADD";     // atmosphere glow, pins + tooltip accent
const PANEL_A = "#EAF3FC", PANEL_B = "#F6FAFE"; // light container gradient framing the atlas globe

// Each church is marked with a branded PIN: the locked IGY speech-bubble mark (primary
// variant — blue bubble, white glyph; path data verbatim from BubbleMark / the locked
// spec IGY-Brand-Identity-Mark-LOCKED-2026-07-27) as the head, on a short IGY-blue point
// whose tip sits at the church location. Inlined SVG (not the React component) because
// globe.gl's htmlElement layer builds the DOM imperatively.
const IGY_MARK_SVG = `<svg viewBox="0 0 72 72" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" style="display:block">
  <path d="M14 10 H58 A8 8 0 0 1 66 18 V48 A8 8 0 0 1 58 56 H28 L14 66 V56 A8 8 0 0 1 6 48 V18 A8 8 0 0 1 14 10 Z" fill="#378ADD"/>
  <ellipse cx="36" cy="16" rx="10" ry="3.5" fill="none" stroke="#FFFFFF" stroke-width="2.4" opacity="0.95"/>
  <rect x="32.85" y="23" width="6.3" height="20" rx="3.15" fill="#FFFFFF" transform="rotate(-8 36 33)"/>
  <circle cx="37.5" cy="48" r="3.78" fill="#FFFFFF"/>
</svg>`;

// A church we couldn't geocode is plotted at its country's centroid (approx=true) and
// rendered dimmer + smaller so it never reads as a precisely-located pin.
const isApprox = (d: GlobePoint) => d.approx === true;

// globe.gl's HTML-elements layer methods aren't in its published TS types; declare the
// chainable subset we use.
interface HtmlLayer {
  htmlElementsData(d: object[]): HtmlLayer;
  htmlLat(accessor: string): HtmlLayer;
  htmlLng(accessor: string): HtmlLayer;
  htmlAltitude(v: number): HtmlLayer;
  htmlElement(fn: (d: object) => HTMLElement): HtmlLayer;
}

/**
 * 3D partner globe. Reuses USN's GlobeModal approach (globe.gl + three) but the
 * library is BUNDLED (dynamic import from node_modules) — NOT loaded from a CDN.
 * The globe surface is a vendored "school atlas" raster (Natural Earth cross-blended
 * hypsometric tints + shaded relief + water + drainages) served from our own /public
 * as globeImageUrl — same-origin, no CDN. IGY-blue country-border outlines (from the
 * vendored 110m GeoJSON) layer crisply ON TOP of the atlas. Each church is a branded
 * IGY pin (globe.gl HTML marker topped with the locked speech-bubble mark). Hovering a
 * pin uses real DOM events to pause auto-rotation and show the tooltip, so it attaches
 * reliably without chasing a moving target. The flat list below is the fallback when
 * WebGL/the globe isn't available. Pin data carries only the same safe fields shown in the list.
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
          .atmosphereAltitude(0.18);

        // Keep the material untinted (white) so the atlas texture shows its true natural
        // colors, and as a light placeholder before the texture finishes loading.
        try { (world.globeMaterial() as { color?: { set: (c: string) => void } }).color?.set("#ffffff"); } catch { /* noop */ }

        const controls = world.controls() as { autoRotate: boolean; autoRotateSpeed: number; enableZoom: boolean };
        controls.autoRotate = true;
        controls.autoRotateSpeed = 0.5;
        controls.enableZoom = true;
        world.pointOfView({ lat: 25, lng: -75, altitude: 2.3 }); // Americas-forward (partners skew US)

        // Branded church pins as globe.gl HTML markers (real DOM), each topped with the
        // locked IGY mark on a short IGY-blue point. Hover uses real DOM mouseenter/leave
        // — no raycasting — so it's reliable: entering a pin pauses auto-rotation (the pin
        // then holds still under the cursor) and shows the tooltip; leaving resumes.
        const holdRotation = () => { if (resumeTimer) { clearTimeout(resumeTimer); resumeTimer = null; } controls.autoRotate = false; };
        const releaseRotation = () => { if (!resumeTimer) resumeTimer = setTimeout(() => { controls.autoRotate = true; resumeTimer = null; }, 180); };

        const makePin = (d: GlobePoint): HTMLElement => {
          const approx = isApprox(d);
          const head = approx ? 24 : 30; // px
          const wrap = document.createElement("div");
          wrap.style.cssText = "position:relative;pointer-events:auto;cursor:pointer;";
          const pin = document.createElement("div");
          // Anchored so the point's tip sits exactly at the church location (globe.gl
          // centers `wrap` on the coordinate; the pin grows upward from bottom:0).
          pin.style.cssText =
            "position:absolute;left:50%;bottom:0;transform:translateX(-50%);transform-origin:50% 100%;" +
            "display:flex;flex-direction:column;align-items:center;transition:transform .15s ease;" +
            "filter:drop-shadow(0 0 1.4px rgba(255,255,255,.9)) drop-shadow(0 2px 3px rgba(4,44,83,.5));" +
            `opacity:${approx ? 0.6 : 1};`;
          pin.innerHTML =
            `<div style="width:${head}px;height:${head}px;line-height:0;">${IGY_MARK_SVG}</div>` +
            `<div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:8px solid ${IGY_BLUE};margin-top:-1px;"></div>`;
          wrap.appendChild(pin);
          wrap.addEventListener("mouseenter", () => {
            holdRotation();
            pin.style.transform = "translateX(-50%) scale(1.18)";
            wrap.style.zIndex = "5";
            setHover(d);
          });
          wrap.addEventListener("mouseleave", () => {
            pin.style.transform = "translateX(-50%) scale(1)";
            wrap.style.zIndex = "";
            releaseRotation();
            setHover(null);
          });
          return wrap;
        };

        (world as unknown as HtmlLayer)
          .htmlElementsData(points as unknown as object[])
          .htmlLat("lat")
          .htmlLng("lng")
          .htmlAltitude(0.006)
          .htmlElement((d: object) => makePin(d as GlobePoint));

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
          Drag to rotate · hover a pin
        </div>
      )}
      {status === "ready" && hasApprox && (
        // Only shown when at least one church is plotted at a country centroid, so
        // viewers understand the two marker styles rather than reading every dot as exact.
        <div style={{ position: "absolute", bottom: 10, left: 14, fontSize: 11, color: "rgba(4,44,83,0.6)", pointerEvents: "none", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: IGY_BLUE, display: "inline-block" }} /> exact
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "rgba(55,138,221,0.5)", display: "inline-block", marginLeft: 6 }} /> approximate (country)
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
