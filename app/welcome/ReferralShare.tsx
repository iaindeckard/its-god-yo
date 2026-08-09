"use client";

import { useState } from "react";

interface Props {
  code: string;
  url: string;
  lang: "en" | "es";
}

const COPY = {
  en: {
    title: "Love It's God, Yo?",
    sub: "Give a friend their first month, and get a free month yourself when they subscribe.",
    codeLabel: "Your referral code",
    share: "Share",
    copy: "Copy link",
    copied: "Copied!",
    shareText: "Try It's God, Yo! Faith that fits in a text. Use my code for a free month:",
  },
  es: {
    title: "¿Te encanta It's God, Yo?",
    sub: "Regálale a un amigo su primer mes, y gánate un mes gratis cuando se suscriba.",
    codeLabel: "Tu código de referido",
    share: "Compartir",
    copy: "Copiar enlace",
    copied: "¡Copiado!",
    shareText: "Prueba It's God, Yo! Fe que cabe en un texto. Usa mi código para un mes gratis:",
  },
} as const;

export default function ReferralShare({ code, url, lang }: Props) {
  const t = COPY[lang];
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked; the code is shown on screen to copy manually */
    }
  }

  async function share() {
    // Native share sheet where available (mobile); otherwise fall back to copying.
    const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
    if (typeof nav.share === "function") {
      try {
        await nav.share({ title: "It's God, Yo!", text: t.shareText, url });
        return;
      } catch {
        /* user dismissed, or share failed; fall through to copy */
      }
    }
    await copyLink();
  }

  return (
    <div
      style={{
        marginTop: 24,
        padding: "18px 18px 20px",
        background: "#0c1c33",
        border: "1px solid #1c356b",
        borderRadius: 14,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <span style={{ fontSize: 22, lineHeight: 1 }} aria-hidden="true">🎁</span>
        <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>{t.title}</h2>
      </div>
      <p style={{ color: "#a9bad6", fontSize: 14, lineHeight: 1.55, margin: "0 0 14px" }}>{t.sub}</p>

      <div style={{ fontSize: 12, color: "#8fb4e6", letterSpacing: 0.4, marginBottom: 6 }}>{t.codeLabel}</div>
      <button
        onClick={copyLink}
        title={t.copy}
        style={{
          width: "100%",
          textAlign: "center",
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: 2,
          color: "#fff",
          background: "#0b1830",
          border: "1px dashed #378ADD",
          borderRadius: 10,
          padding: "12px 14px",
          fontFamily: "inherit",
          cursor: "pointer",
        }}
      >
        {code}
      </button>

      <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
        <button
          onClick={share}
          style={{
            flex: 1,
            padding: "11px 16px",
            fontSize: 15,
            fontWeight: 700,
            borderRadius: 10,
            border: "none",
            background: "#378ADD",
            color: "#fff",
            fontFamily: "inherit",
            cursor: "pointer",
          }}
        >
          {t.share}
        </button>
        <button
          onClick={copyLink}
          style={{
            flex: 1,
            padding: "11px 16px",
            fontSize: 15,
            fontWeight: 700,
            borderRadius: 10,
            border: "1px solid #24406b",
            background: "#0c1c33",
            color: copied ? "#8fe0a8" : "#d7e4f6",
            fontFamily: "inherit",
            cursor: "pointer",
          }}
        >
          {copied ? t.copied : t.copy}
        </button>
      </div>
    </div>
  );
}
