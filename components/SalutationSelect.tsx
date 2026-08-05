"use client";

import { useState } from "react";
import { salutationOptions, isKnownSalutation, type Lang } from "@/lib/salutations";

/**
 * Structured multi-select for salutations / honorific titles, ordered by the
 * caller's language preference (full combined list always shown — nobody is
 * restricted to one language). Selection order is preserved. Includes an "Other"
 * free-text fallback; a custom value is just another element in the array.
 *
 * Controlled: `value` is the ordered string[] currently selected; `onChange`
 * receives the new array. Reused by the signup purchaser step and the Cornerstone
 * application form.
 */
export default function SalutationSelect({
  lang,
  value,
  onChange,
  label = "Title(s)",
  otherLabel = "Other",
  hint = "Optional. Pick any that apply. Combine titles if you like (e.g. Rev. Dr.).",
}: {
  lang: Lang;
  value: string[];
  onChange: (next: string[]) => void;
  label?: string;
  otherLabel?: string;
  hint?: string;
}) {
  const [other, setOther] = useState("");
  const options = salutationOptions(lang);
  // Custom (non-canonical) selected values, shown as their own removable chips.
  const customSelected = value.filter((v) => !isKnownSalutation(v));

  const toggle = (t: string) => {
    onChange(value.includes(t) ? value.filter((x) => x !== t) : [...value, t]);
  };
  const addOther = () => {
    const v = other.trim();
    if (v && !value.includes(v)) onChange([...value, v]);
    setOther("");
  };

  return (
    <div className="field">
      <label>{label}</label>
      {hint ? <div style={{ fontSize: 12, color: "#7686a0", marginBottom: 6 }}>{hint}</div> : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {options.map((t) => {
          const on = value.includes(t);
          return (
            <button
              type="button"
              key={t}
              aria-pressed={on}
              onClick={() => toggle(t)}
              style={{
                padding: "5px 11px",
                borderRadius: 999,
                cursor: "pointer",
                fontSize: 13,
                border: on ? "1px solid rgba(255,211,122,0.55)" : "1px solid rgba(0,0,0,0.15)",
                background: on ? "rgba(255,211,122,0.18)" : "transparent",
                color: on ? "#7a5c00" : "inherit",
                fontWeight: on ? 600 : 400,
              }}
            >
              {t}
            </button>
          );
        })}
        {customSelected.map((t) => (
          <button
            type="button"
            key={`custom-${t}`}
            aria-pressed={true}
            onClick={() => toggle(t)}
            title="Remove"
            style={{
              padding: "5px 11px",
              borderRadius: 999,
              cursor: "pointer",
              fontSize: 13,
              border: "1px solid rgba(126,168,224,0.6)",
              background: "rgba(126,168,224,0.18)",
              fontWeight: 600,
            }}
          >
            {t} ✕
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <input
          type="text"
          value={other}
          placeholder={otherLabel}
          onChange={(e) => setOther(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addOther();
            }
          }}
          style={{ flex: 1 }}
        />
        <button type="button" className="btn btn-ghost" style={{ padding: "5px 12px", fontSize: 13 }} onClick={addOther} disabled={!other.trim()}>
          Add
        </button>
      </div>
      {value.length > 0 ? (
        <div style={{ fontSize: 12, color: "#7686a0", marginTop: 6 }}>Selected (in order): {value.join(" ")}</div>
      ) : null}
    </div>
  );
}
