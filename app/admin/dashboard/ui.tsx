"use client";

import { useEffect, type ReactNode } from "react";
import { POS, NEG, SLATE } from "./charts/theme";

/** Titled chart card. `right` is an optional header-right slot (toggles, legends). */
export function Card({ title, subtitle, right, span, children }: { title?: ReactNode; subtitle?: ReactNode; right?: ReactNode; span?: 1 | 2 | 3 | 4; children: ReactNode }) {
  return (
    <div className={`dash-card${span ? ` span-${span}` : ""}`}>
      {(title || right) && (
        <div className="dash-card-head">
          <div>
            {title && <div className="dash-card-title">{title}</div>}
            {subtitle && <div className="dash-card-sub">{subtitle}</div>}
          </div>
          {right && <div className="dash-card-right">{right}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

/** Directional delta chip (▲/▼) — green when the direction is good. */
export function Delta({ pct, goodWhenUp = true }: { pct: number | null; goodWhenUp?: boolean }) {
  if (pct == null || !isFinite(pct)) return null;
  const up = pct >= 0;
  const good = up === goodWhenUp;
  return (
    <span style={{ fontSize: 12, fontWeight: 700, color: good ? POS : NEG }}>
      {up ? "▲" : "▼"} {Math.abs(pct).toFixed(0)}%
    </span>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return <span style={{ color: SLATE }}>{children}</span>;
}

/** Lightweight modal for drill-downs (Escape / backdrop to close). */
export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="dash-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="dash-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dash-modal-head">
          <div className="dash-card-title">{title}</div>
          <button className="dash-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
