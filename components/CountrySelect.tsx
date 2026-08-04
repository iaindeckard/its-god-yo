"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { COUNTRIES, searchCountries, countryByIso2, flagEmoji, type Country } from "@/lib/countries";

/**
 * Searchable country picker for the signup phone step. Controlled by `value`
 * (ISO2) / `onChange(iso2)`. Users can type to whittle the list by country name,
 * dial code, or ISO code — replacing the old "type the +1 yourself" free-text
 * entry. The caller pairs this with a national-number input and builds E.164 via
 * lib/phone.toE164FromParts(dial, national).
 */
export default function CountrySelect({
  value,
  onChange,
  lang,
  id,
}: {
  value: string;
  onChange: (iso2: string) => void;
  lang: "en" | "es";
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const selected: Country = countryByIso2(value);
  const results = useMemo(() => searchCountries(query), [query]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Focus the search box + reset highlight whenever the panel opens.
  useEffect(() => {
    if (open) {
      setActive(Math.max(0, results.findIndex((c) => c.iso2 === selected.iso2)));
      const el = inputRef.current;
      if (el) setTimeout(() => el.focus(), 0);
    } else {
      setQuery("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keep the highlighted option in view.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const node = listRef.current.children[active] as HTMLElement | undefined;
    node?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function choose(c: Country) {
    onChange(c.iso2);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const c = results[active];
      if (c) choose(c);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  const placeholder = lang === "es" ? "Busca tu país…" : "Search your country…";
  const noResults = lang === "es" ? "Sin resultados" : "No matches";

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        type="button"
        id={id}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          textAlign: "left",
          padding: "10px 12px",
          borderRadius: 10,
          border: "1px solid rgba(0,0,0,0.15)",
          background: "#fff",
          cursor: "pointer",
          font: "inherit",
        }}
      >
        <span style={{ fontSize: 18, lineHeight: 1 }} aria-hidden>{flagEmoji(selected.iso2)}</span>
        <span style={{ flex: 1 }}>{selected.name}</span>
        <span className="muted" style={{ fontVariantNumeric: "tabular-nums" }}>+{selected.dial}</span>
        <span aria-hidden style={{ opacity: 0.5 }}>▾</span>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            zIndex: 40,
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            background: "#fff",
            border: "1px solid rgba(0,0,0,0.15)",
            borderRadius: 10,
            boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: 8, borderBottom: "1px solid rgba(0,0,0,0.08)" }}>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActive(0); }}
              onKeyDown={onKeyDown}
              placeholder={placeholder}
              aria-label={placeholder}
              autoComplete="off"
              style={{ width: "100%" }}
            />
          </div>
          <ul
            ref={listRef}
            role="listbox"
            style={{ listStyle: "none", margin: 0, padding: 4, maxHeight: 260, overflowY: "auto" }}
          >
            {results.length === 0 && (
              <li className="muted" style={{ padding: "10px 12px", fontSize: 14 }}>{noResults}</li>
            )}
            {results.map((c, i) => {
              const on = c.iso2 === selected.iso2;
              const hi = i === active;
              return (
                <li
                  key={c.iso2}
                  role="option"
                  aria-selected={on}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(c)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 10px",
                    borderRadius: 8,
                    cursor: "pointer",
                    background: hi ? "rgba(126,168,224,0.16)" : on ? "rgba(255,211,122,0.16)" : "transparent",
                  }}
                >
                  <span style={{ fontSize: 18, lineHeight: 1 }} aria-hidden>{flagEmoji(c.iso2)}</span>
                  <span style={{ flex: 1 }}>{c.name}</span>
                  <span className="muted" style={{ fontVariantNumeric: "tabular-nums" }}>+{c.dial}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

// Re-exported for callers that need the raw list (e.g. tests / SSR-safe defaults).
export { COUNTRIES };
