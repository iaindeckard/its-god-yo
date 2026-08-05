"use client";

import { useState } from "react";

const TEAL = "#00ABBC";

/**
 * A read-only value (an enrollment link or code) with a one-tap Copy button.
 * The only client JS on the otherwise-static Cornerstone status page.
 */
export default function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — the value is selectable in the field as a fallback */
    }
  };

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ color: "#5b6472", fontSize: 12, marginBottom: 4 }}>{label}</div>
      <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
        <input
          readOnly
          value={value}
          onFocus={(e) => e.currentTarget.select()}
          style={{ flex: 1, minWidth: 0, padding: "10px 12px", borderRadius: 8, border: "1px solid #d7dbe2", background: "#f7f9fb", color: "#1a1f2b", fontSize: 14 }}
        />
        <button
          type="button"
          onClick={copy}
          style={{ padding: "10px 16px", borderRadius: 8, border: `1px solid ${TEAL}`, background: copied ? TEAL : "#fff", color: copied ? "#fff" : TEAL, fontWeight: 600, fontSize: 14, whiteSpace: "nowrap", cursor: "pointer" }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
