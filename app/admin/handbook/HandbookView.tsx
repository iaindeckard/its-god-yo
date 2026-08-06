"use client";

import React, { useMemo, useState, useEffect, useRef } from "react";
import type { Block, CalloutKind, Entry, Part } from "./content";

// IGY brand accents. Blue is primary; gold is the reserved accent (kept to a few
// parts so it stays special).
const BLUE = "#378ADD"; // vivid brand blue — decorative accent BARS/fills only (>=4.8:1 as a graphic on the navy)
const GOLD = "#FFDC52";
// Brand blue is only ~4.8:1 on the navy: acceptable for bars, but not comfortable
// for small TEXT. Text accents use the site's on-dark blue (~7:1), matching the
// public dark pages (legal / iotnbo / cornerstone-partners). All pairs WCAG AA audited.
const BLUE_TEXT = "#7ea8e0";
type Accent = "blue" | "gold";
const PART_ACCENT: Record<string, Accent> = {
  "start-here": "blue",
  "welcome-mission": "gold",
  "the-product": "blue",
  programs: "blue",
  "how-we-operate": "gold",
  "admin-panel": "blue",
  "policies-escalation": "gold",
  "common-questions": "blue",
  glossary: "blue",
};
const accentHex = (id: string) => (PART_ACCENT[id] === "gold" ? GOLD : BLUE); // accent BAR/fill
const accentText = (id: string) => (PART_ACCENT[id] === "gold" ? GOLD : BLUE_TEXT); // accent TEXT (AA-safe)

const CALLOUT: Record<CalloutKind, { color: string; bg: string; border: string; label: string }> = {
  info: { color: "#7EB8F0", bg: "rgba(55,138,221,0.10)", border: "rgba(55,138,221,0.45)", label: "Good to know" },
  tip: { color: "#8FD0C9", bg: "rgba(0,171,188,0.10)", border: "rgba(0,171,188,0.40)", label: "Tip" },
  warning: { color: GOLD, bg: "rgba(255,220,82,0.10)", border: "rgba(255,220,82,0.45)", label: "Heads up" },
  danger: { color: "#F6A6A6", bg: "rgba(224,73,73,0.12)", border: "rgba(224,73,73,0.50)", label: "Hard rule" },
  escalate: { color: "#F6A6A6", bg: "rgba(224,73,73,0.16)", border: "rgba(224,73,73,0.65)", label: "Escalate now" },
};

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case "prose":
      return <p style={{ fontSize: 14.5, lineHeight: 1.65, margin: "10px 0", color: "var(--igy-admin-text, #e7edf6)" }}>{block.text}</p>;
    case "subheading":
      return <h4 style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", margin: "18px 0 6px", color: BLUE_TEXT }}>{block.text}</h4>;
    case "list":
      return React.createElement(
        block.ordered ? "ol" : "ul",
        { style: { margin: "10px 0", paddingLeft: 22, lineHeight: 1.65, fontSize: 14.5, color: "var(--igy-admin-text, #e7edf6)" } },
        block.items.map((it, i) => <li key={i} style={{ margin: "5px 0" }}>{it}</li>),
      );
    case "table":
      return (
        <div style={{ margin: "14px 0", overflowX: "auto", borderRadius: 10, border: "1px solid rgba(255,255,255,0.10)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5, textAlign: "left" }}>
            <thead>
              <tr>
                {block.head.map((h, i) => (
                  <th key={i} style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--igy-on-dark-meta, #9fb0c9)", background: "rgba(255,255,255,0.03)", padding: "9px 12px", borderBottom: "1px solid rgba(255,255,255,0.10)", verticalAlign: "top" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci} style={{ padding: "9px 12px", verticalAlign: "top", lineHeight: 1.55, borderBottom: ri === block.rows.length - 1 ? "none" : "1px solid rgba(255,255,255,0.07)", color: ci === 0 ? "var(--igy-admin-text, #e7edf6)" : "rgba(231,237,246,0.82)", fontWeight: ci === 0 ? 600 : 400 }}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "callout": {
      const s = CALLOUT[block.kind];
      return (
        <div style={{ background: s.bg, borderLeft: `3px solid ${s.border}`, borderRadius: 8, padding: "12px 14px", margin: "14px 0" }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: s.color, marginBottom: 5 }}>{block.title ?? s.label}</div>
          <p style={{ fontSize: 14, lineHeight: 1.6, margin: 0, color: "var(--igy-admin-text, #e7edf6)" }}>{block.text}</p>
        </div>
      );
    }
    default:
      return null;
  }
}

function entryText(entry: Entry): string {
  const parts: string[] = [entry.title, entry.kicker ?? "", entry.address ?? ""];
  for (const b of entry.blocks) {
    if (b.type === "prose" || b.type === "subheading") parts.push(b.text);
    else if (b.type === "list") parts.push(b.items.join(" "));
    else if (b.type === "table") parts.push(b.head.join(" "), b.rows.flat().join(" "));
    else if (b.type === "callout") parts.push(b.title ?? "", b.text);
  }
  return parts.join(" ").toLowerCase();
}

export default function HandbookView({ parts, hiddenCount, updated, jobRole }: { parts: Part[]; hiddenCount: number; updated: string; jobRole: string }) {
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string>("");
  const contentRef = useRef<HTMLDivElement>(null);

  const searchIndex = useMemo(() => {
    const idx = new Map<string, string>();
    for (const part of parts) for (const entry of part.entries) idx.set(entry.id, entryText(entry));
    return idx;
  }, [parts]);

  const q = query.trim().toLowerCase();
  const filtered: Part[] = useMemo(() => {
    if (!q) return parts;
    return parts
      .map((part) => ({ ...part, entries: part.entries.filter((e) => (searchIndex.get(e.id) ?? "").includes(q)) }))
      .filter((part) => part.entries.length > 0);
  }, [q, parts, searchIndex]);

  const totalMatches = useMemo(() => filtered.reduce((n, p) => n + p.entries.length, 0), [filtered]);

  // Highlight the entry currently in view (only when not searching).
  useEffect(() => {
    if (q) return;
    const nodes = contentRef.current?.querySelectorAll("[data-entry-id]");
    if (!nodes || nodes.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActiveId(vis[0].target.getAttribute("data-entry-id") ?? "");
      },
      { rootMargin: "-90px 0px -65% 0px", threshold: 0 },
    );
    nodes.forEach((n) => observer.observe(n));
    return () => observer.disconnect();
  }, [q, filtered]);

  const jumpTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 20, behavior: "smooth" });
  };

  return (
    <div className="handbook-root">
    <div style={{ maxWidth: 1120, margin: "0 auto" }}>
      {/* HERO */}
      <div className="admin-head" style={{ display: "block", marginBottom: 8 }}>
        <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.28em", color: BLUE_TEXT, margin: "0 0 6px" }}>IGY Employee Manual</p>
        <h1 style={{ margin: 0 }}>How IGY Actually Works</h1>
        <p className="muted" style={{ maxWidth: 640, marginTop: 8, lineHeight: 1.6 }}>
          Every plan, program, flag, and admin screen, written so a brand-new teammate can help a real customer and know exactly what to do. You&rsquo;re viewing as <strong style={{ color: "var(--igy-admin-text, #e7edf6)" }}>{jobRole || "staff"}</strong>.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginTop: 10 }}>
          <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--igy-on-dark-meta, #9fb0c9)" }}>Last updated {updated}</span>
          <button className="btn btn-ghost" onClick={() => window.print()} style={{ fontSize: 12, padding: "5px 12px" }}>Print / Save as PDF</button>
        </div>
        {hiddenCount > 0 && (
          <p style={{ fontSize: 12.5, color: "var(--igy-on-dark-meta, #9fb0c9)", marginTop: 10 }}>
            🔒 {hiddenCount} {hiddenCount === 1 ? "section is" : "sections are"} limited to other roles and hidden from your view.
          </p>
        )}
      </div>

      {/* SEARCH */}
      <div style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--igy-admin-bg, #0b1830)", padding: "10px 0", marginBottom: 4 }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the manual: a plan, a screen, a policy…"
          aria-label="Search the employee manual"
          style={{ width: "100%", background: "rgba(255,255,255,0.05)", border: `1px solid ${query ? BLUE : "rgba(255,255,255,0.14)"}`, borderRadius: 12, padding: "11px 14px", fontSize: 14, color: "var(--igy-admin-text, #e7edf6)", outline: "none" }}
        />
        {q && <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>{totalMatches} {totalMatches === 1 ? "result" : "results"} for &ldquo;{query.trim()}&rdquo;</p>}
      </div>

      {/* QUICK-JUMP (hidden while searching) */}
      {!q && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10, margin: "6px 0 20px" }}>
          {parts.map((part) => {
            return (
              <button key={part.id} onClick={() => jumpTo(part.id)} className="card" style={{ textAlign: "left", cursor: "pointer", padding: "12px 14px", borderColor: "rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.03)" }}>
                <span style={{ display: "block", fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.16em", color: accentText(part.id) }}>{part.number ? `Part ${part.number}` : "Reference"}</span>
                <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, marginTop: 2, color: "var(--igy-admin-text, #e7edf6)" }}>{part.title}</span>
              </button>
            );
          })}
        </div>
      )}

      <div style={{ display: "flex", gap: 28, alignItems: "flex-start" }}>
        {/* TABLE OF CONTENTS */}
        <nav className="handbook-toc" style={{ width: 236, flexShrink: 0, position: "sticky", top: 72, maxHeight: "calc(100vh - 90px)", overflowY: "auto", paddingBottom: 24 }}>
          {filtered.map((part) => {
            return (
              <div key={part.id} style={{ marginBottom: 14 }}>
                <button onClick={() => jumpTo(part.id)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: accentText(part.id), marginBottom: 4, textAlign: "left" }}>
                  {part.number ? `${part.number}. ` : ""}{part.title}
                </button>
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {part.entries.map((entry) => {
                    const active = activeId === entry.id && !q;
                    return (
                      <li key={entry.id}>
                        <button
                          onClick={() => jumpTo(entry.id)}
                          style={{ display: "block", width: "100%", textAlign: "left", background: active ? "rgba(55,138,221,0.14)" : "transparent", border: "none", cursor: "pointer", fontSize: 12.5, lineHeight: 1.35, padding: "5px 8px", borderRadius: 6, color: active ? accentText(part.id) : "var(--igy-on-dark-meta, #9fb0c9)", fontWeight: active ? 600 : 400 }}
                        >
                          {entry.title}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>

        {/* CONTENT */}
        <div ref={contentRef} style={{ minWidth: 0, flex: 1 }}>
          {filtered.length === 0 && (
            <div className="card" style={{ textAlign: "center", padding: 40 }}>
              <p style={{ fontWeight: 700, marginBottom: 4 }}>No matches</p>
              <p className="muted">Nothing in the manual matches &ldquo;{query.trim()}&rdquo;. Try a broader word, or clear the search.</p>
            </div>
          )}

          {filtered.map((part) => {
            const a = accentHex(part.id);
            return (
              <section key={part.id} id={part.id} style={{ marginBottom: 40, scrollMarginTop: 20 }}>
                <div style={{ marginBottom: 14 }}>
                  {part.number && <span style={{ display: "block", fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.2em", color: accentText(part.id) }}>Part {part.number}</span>}
                  <h2 style={{ fontSize: 26, fontWeight: 800, margin: "2px 0 0", color: "var(--igy-admin-text, #e7edf6)" }}>{part.title}</h2>
                  <div style={{ height: 2, width: 46, background: a, borderRadius: 2, margin: "10px 0 0" }} />
                  {part.blurb && <p className="muted" style={{ marginTop: 10, maxWidth: 640, lineHeight: 1.6 }}>{part.blurb}</p>}
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {part.entries.map((entry) => (
                    <article key={entry.id} id={entry.id} data-entry-id={entry.id} className="card" style={{ scrollMarginTop: 20 }}>
                      {entry.kicker && <p style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.16em", color: "var(--igy-on-dark-meta, #9fb0c9)", margin: "0 0 4px" }}>{entry.kicker}</p>}
                      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 12px" }}>
                        <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: "var(--igy-admin-text, #e7edf6)" }}>{entry.title}</h3>
                        {entry.address && (
                          <span style={{ fontSize: 11.5, fontFamily: "ui-monospace, monospace", padding: "2px 8px", borderRadius: 6, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", color: accentText(part.id) }}>{entry.address}</span>
                        )}
                      </div>
                      <div style={{ marginTop: 2 }}>
                        {entry.blocks.map((block, i) => <BlockView key={i} block={block} />)}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
    </div>
  );
}
