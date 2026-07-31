"use client";

import { useEffect, useMemo, useState } from "react";
import {
  sendTimeSlots,
  formatSlot,
  SEND_TIME_DEFAULT,
  COMMON_TIMEZONES,
  isValidTimezone,
} from "@/lib/sendTime";

interface Props {
  token: string;
  firstName: string | null;
  lang: "en" | "es";
  initialTime: string | null; // "HH:MM[:SS]" or null (=> noon)
  initialTz: string | null;   // IANA or null (=> auto-detect)
}

const COPY = {
  en: {
    heading: (name: string | null) => (name ? `Hi ${name}! 👋` : "You're all set! 👋"),
    sub: "Pick when you'd like your daily verse to land. You can change it anytime.",
    timeLabel: "Daily text time",
    tzLabel: "Your timezone",
    save: "Save my time",
    saving: "Saving…",
    saved: "Saved! Your daily verse will arrive around",
    savedTz: "in",
    err: "Couldn't save that. Please try again.",
    floorNote: "Earliest is 7:00 AM.",
  },
  es: {
    heading: (name: string | null) => (name ? `¡Hola ${name}! 👋` : "¡Todo listo! 👋"),
    sub: "Elige a qué hora quieres recibir tu versículo diario. Puedes cambiarlo cuando quieras.",
    timeLabel: "Hora del texto diario",
    tzLabel: "Tu zona horaria",
    save: "Guardar mi hora",
    saving: "Guardando…",
    saved: "¡Guardado! Tu versículo diario llegará alrededor de las",
    savedTz: "en",
    err: "No se pudo guardar — inténtalo de nuevo.",
    floorNote: "Lo más temprano es 7:00 AM.",
  },
} as const;

// "HH:MM:SS" | "HH:MM" -> "HH:MM"
function toHHMM(t: string | null): string | null {
  if (!t) return null;
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

export default function WelcomeForm({ token, firstName, lang, initialTime, initialTz }: Props) {
  const t = COPY[lang];
  const slots = useMemo(() => sendTimeSlots(), []);
  const [time, setTime] = useState<string>(toHHMM(initialTime) ?? SEND_TIME_DEFAULT);
  const [tz, setTz] = useState<string>(initialTz ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-detect the timezone once, only when the row has none stored yet.
  useEffect(() => {
    if (tz) return;
    try {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (isValidTimezone(detected)) setTz(detected);
    } catch {
      /* leave blank; the server falls back if never set */
    }
  }, [tz]);

  // Offer the curated zones plus the detected/stored one if it isn't already listed.
  const tzOptions = useMemo(() => {
    const opts = [...COMMON_TIMEZONES];
    if (tz && !opts.some((o) => o.id === tz)) opts.unshift({ id: tz, label: tz });
    return opts;
  }, [tz]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/welcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, send_time_local: time, timezone: tz }),
      });
      if (!res.ok) {
        setError(t.err);
        return;
      }
      setSaved(true);
    } catch {
      setError(t.err);
    } finally {
      setBusy(false);
    }
  }

  const fieldStyle: React.CSSProperties = {
    width: "100%",
    padding: "12px 14px",
    fontSize: 16,
    borderRadius: 10,
    border: "1px solid #24406b",
    background: "#0c1c33",
    color: "#fff",
    fontFamily: "inherit",
  };
  const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, color: "#8fb4e6", marginBottom: 6, marginTop: 18 };

  return (
    <div>
      <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 8 }}>{t.heading(firstName)}</h1>
      <p style={{ color: "#a9bad6", lineHeight: 1.6, fontSize: 15, marginBottom: 8 }}>{t.sub}</p>

      <label style={labelStyle} htmlFor="send-time">{t.timeLabel}</label>
      <select id="send-time" style={fieldStyle} value={time} onChange={(e) => { setTime(e.target.value); setSaved(false); }} disabled={busy}>
        {slots.map((s) => (
          <option key={s} value={s}>{formatSlot(s)}</option>
        ))}
      </select>
      <div style={{ fontSize: 12, color: "#7f9cc4", marginTop: 6 }}>{t.floorNote}</div>

      <label style={labelStyle} htmlFor="tz">{t.tzLabel}</label>
      <select id="tz" style={fieldStyle} value={tz} onChange={(e) => { setTz(e.target.value); setSaved(false); }} disabled={busy}>
        {tzOptions.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>

      <button
        onClick={save}
        disabled={busy || !tz}
        style={{
          width: "100%",
          marginTop: 24,
          padding: "13px 16px",
          fontSize: 16,
          fontWeight: 700,
          borderRadius: 10,
          border: "none",
          cursor: busy || !tz ? "default" : "pointer",
          background: busy || !tz ? "#2b477a" : "#378ADD",
          color: "#fff",
          fontFamily: "inherit",
        }}
      >
        {busy ? t.saving : t.save}
      </button>

      {saved && (
        <p style={{ marginTop: 16, color: "#8fe0a8", fontSize: 15, textAlign: "center" }}>
          {t.saved} <strong>{formatSlot(time)}</strong> {t.savedTz} {tz}. 🙏
        </p>
      )}
      {error && (
        <p style={{ marginTop: 16, color: "#f5b5b5", fontSize: 15, textAlign: "center" }}>{error}</p>
      )}
    </div>
  );
}
