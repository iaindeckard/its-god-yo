"use client";

import { useState } from "react";
import type { RosterStatus } from "@/lib/churchRoster";

const TEAL = "#00ABBC";
const GOLD = "#C79A00";

/**
 * Optional roster tracker (Phase 2). The minister pastes a plain list of first
 * names; we show how many have joined through their link. Names only — this never
 * texts anyone, collects a phone number, or signs anyone up. Match state is
 * computed server-side against teens' own self-signups.
 */
export default function RosterTracker({
  initial, auth,
}: {
  initial: RosterStatus;
  auth: { p: string; t: string };
}) {
  const [status, setStatus] = useState<RosterStatus>(initial);
  const [text, setText] = useState(initial.names.map((n) => n.firstName).join("\n"));
  const [open, setOpen] = useState(initial.total === 0 ? false : true);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true); setErr(null); setSaved(false);
    try {
      const names = text.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
      const res = await fetch("/api/cornerstone/roster", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ p: auth.p, t: auth.t, names }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Couldn't save your list.");
      setStatus(d.status as RosterStatus);
      setText((d.status as RosterStatus).names.map((n) => n.firstName).join("\n"));
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2200);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save your list.");
    } finally {
      setBusy(false);
    }
  }

  const btn: React.CSSProperties = {
    padding: "9px 16px", borderRadius: 8, border: `1px solid ${TEAL}`, background: TEAL,
    color: "#fff", fontWeight: 600, fontSize: 14, cursor: "pointer",
  };
  const ghost: React.CSSProperties = {
    padding: "9px 16px", borderRadius: 8, border: "1px solid #d7dbe2", background: "#fff",
    color: "#1a1f2b", fontWeight: 600, fontSize: 14, cursor: "pointer",
  };
  const chip = (bg: string, color: string): React.CSSProperties => ({
    display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 999,
    background: bg, color, fontSize: 13, margin: "0 6px 6px 0",
  });

  return (
    <div style={{ marginTop: 24, paddingTop: 20, borderTop: "1px solid #eef0f4" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <div>
          <div style={{ fontSize: 12, letterSpacing: "0.14em", textTransform: "uppercase", color: TEAL, fontWeight: 700, marginBottom: 4 }}>
            Optional
          </div>
          <h2 style={{ fontSize: 18, margin: 0, color: "#111826" }}>Track your list</h2>
        </div>
        <button type="button" onClick={() => setOpen((o) => !o)} style={{ ...ghost, padding: "6px 12px", fontSize: 13 }}>
          {open ? "Hide" : status.total > 0 ? "Show" : "Set up"}
        </button>
      </div>

      {open && (
        <div style={{ marginTop: 12 }}>
          <p style={{ color: "#4a5462", fontSize: 14, lineHeight: 1.55, margin: "0 0 12px" }}>
            Paste a list of first names to see how many have joined. This is just a tracker for you.
            It never sends anyone a message, never asks for a phone number, and never signs anyone up.
            A name shows as joined only when a teen enters that same first name in their own signup.
          </p>

          {status.total > 0 && (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 28, fontWeight: 700, color: "#111826" }}>{status.joined}</span>
                <span style={{ fontSize: 15, color: "#4a5462" }}>of {status.total} on your list have joined</span>
              </div>
              <div style={{ marginBottom: 6 }}>
                {status.names.map((n, i) => (
                  <span
                    key={`${n.firstName}-${i}`}
                    style={
                      n.joined ? chip("#e7f7ea", "#1a7f37")
                      : n.matched ? chip("#fff7e0", GOLD)
                      : chip("#f3f4f6", "#6b7280")
                    }
                  >
                    {n.joined ? "✓" : n.matched ? "…" : "·"} {n.firstName}
                  </span>
                ))}
              </div>
              <p style={{ color: "#9aa2ad", fontSize: 12, margin: "2px 0 14px" }}>
                ✓ joined{status.invited > 0 ? `  ·  … invited, not yet confirmed (${status.invited})` : ""}  ·  · not yet
              </p>
            </>
          )}

          {editing || status.total === 0 ? (
            <>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={"One first name per line, e.g.\nMaya\nEli\nSofia"}
                rows={8}
                style={{ width: "100%", boxSizing: "border-box", padding: "12px 14px", borderRadius: 10, border: "1px solid #d7dbe2", fontSize: 14, lineHeight: 1.5, resize: "vertical", fontFamily: "inherit" }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
                <button type="button" onClick={save} disabled={busy} style={{ ...btn, opacity: busy ? 0.6 : 1 }}>
                  {busy ? "Saving…" : "Save list"}
                </button>
                {status.total > 0 && (
                  <button
                    type="button"
                    onClick={() => { setText(status.names.map((n) => n.firstName).join("\n")); setEditing(false); setErr(null); }}
                    style={ghost}
                  >
                    Cancel
                  </button>
                )}
                {saved && <span style={{ color: "#1a7f37", fontSize: 13 }}>Saved.</span>}
                {err && <span style={{ color: "#b42318", fontSize: 13 }}>{err}</span>}
              </div>
            </>
          ) : (
            <button type="button" onClick={() => setEditing(true)} style={ghost}>Edit list</button>
          )}
        </div>
      )}
    </div>
  );
}
