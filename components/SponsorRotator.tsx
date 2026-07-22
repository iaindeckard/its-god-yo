"use client";

import { useEffect, useRef, useState } from "react";
import s from "./landing.module.css";

interface Sponsor { id: string; name: string; logo_url: string }

const SLIDE_MS = 4000; // ~4s per logo (spec: 3–5s, default 4)

/**
 * Homepage sponsor rotator — one logo at a time, gentle opacity cross-fade,
 * continuous loop through active sponsors. Accessibility (non-negotiable):
 *  - a VISIBLE pause/play control (not only OS reduce-motion);
 *  - respects prefers-reduced-motion by DEFAULTING TO PAUSED (static, one logo);
 *  - the rotating region is aria-live="off" so it never spams screen readers,
 *    and a visually-hidden list names every sponsor once; inactive logos are
 *    aria-hidden so only the visible one is reachable;
 *  - each logo's alt text is the sponsor name;
 *  - the transition is a gentle opacity fade, and is disabled entirely under
 *    prefers-reduced-motion.
 * Renders nothing when there are no active sponsors.
 */
export default function SponsorRotator() {
  const [sponsors, setSponsors] = useState<Sponsor[] | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/sponsors")
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setSponsors(Array.isArray(d.sponsors) ? d.sponsors : []); })
      .catch(() => { if (!cancelled) setSponsors([]); });
    return () => { cancelled = true; };
  }, []);

  // Respect prefers-reduced-motion: default to paused/static if set.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq.matches) setPlaying(false);
    const onChange = (e: MediaQueryListEvent) => { if (e.matches) setPlaying(false); };
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  // Advance timer — only while playing and there's more than one sponsor.
  useEffect(() => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    if (playing && sponsors && sponsors.length > 1) {
      timer.current = setInterval(() => setIndex((i) => (i + 1) % sponsors.length), SLIDE_MS);
    }
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [playing, sponsors]);

  if (!sponsors || sponsors.length === 0) return null;
  const multiple = sponsors.length > 1;

  return (
    <section className={s.sponsorSection} aria-labelledby="sponsor-heading">
      <div className={s.wrap}>
        <div className={s.eyebrow}>OUR SPONSORS</div>
        <h2 id="sponsor-heading" className={s.sponsorHeadline}>We couldn&rsquo;t do it without you.</h2>
        <p className={s.sponsorSub}>These are the churches, schools, and organizations who share our mission and help make it possible.</p>

        {/* Visually-hidden roster so screen readers get the full set once, not per-rotation. */}
        <p className={s.srOnly}>Our sponsors: {sponsors.map((sp) => sp.name).join(", ")}.</p>

        <div className={s.sponsorStage} aria-live="off">
          {sponsors.map((sp, i) => (
            <img
              key={sp.id}
              src={sp.logo_url}
              alt={sp.name}
              aria-hidden={i !== index}
              className={`${s.sponsorLogo} ${i === index ? s.sponsorLogoActive : ""}`}
            />
          ))}
        </div>

        {multiple && (
          <div className={s.sponsorControls}>
            <button
              type="button"
              className={s.sponsorPause}
              aria-pressed={!playing}
              aria-label={playing ? "Pause sponsor rotation" : "Play sponsor rotation"}
              onClick={() => setPlaying((p) => !p)}
            >
              {playing ? "❚❚ Pause" : "▶ Play"}
            </button>
            <div className={s.sponsorDots} aria-hidden="true">
              {sponsors.map((sp, i) => (
                <span key={sp.id} className={`${s.sponsorDot} ${i === index ? s.sponsorDotOn : ""}`} />
              ))}
            </div>
          </div>
        )}

        <div className={s.sponsorFooterLinks}>
          <a href="/sponsors">See everyone</a>
          <span aria-hidden="true">·</span>
          <a href="/sponsor-inquiry">Interested in sponsoring?</a>
        </div>
      </div>
    </section>
  );
}
