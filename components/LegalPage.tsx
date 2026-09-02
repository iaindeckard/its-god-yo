import Link from "next/link";
import type { ReactNode } from "react";
import Wordmark from "./Wordmark";
import s from "./legal.module.css";

export default function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <main className={s.page}>
      <header className={s.header}>
        <div className={s.nav}>
          <Link href="/" style={{ textDecoration: "none" }}><Wordmark tone="brass" /></Link>
          <Link href="/" className={s.home}>&larr; Home</Link>
        </div>
      </header>
      <div className={s.wrap}>
        <div className={s.head}>
          <h1>{title}</h1>
          <div className={s.updated}>Last updated: {updated}</div>
          <div className={s.operator}>Operated by Deckard Enterprise International, LLC &middot; Wichita, KS 67205</div>
        </div>
        <div className={s.prose}>
          <p style={{ color: "#7686a0", fontSize: 13, lineHeight: 1.6, fontStyle: "italic", marginBottom: 22 }}>
            If any Spanish-language version of this page conflicts with the English version, the English version governs.
            <br />
            Si alguna versi&oacute;n en espa&ntilde;ol de esta p&aacute;gina entra en conflicto con la versi&oacute;n en ingl&eacute;s, la versi&oacute;n en ingl&eacute;s prevalece.
          </p>
          {children}
        </div>
        <div className={s.foot}>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/cookies">Cookies</Link>
          <Link href="/">Home</Link>
        </div>
      </div>
    </main>
  );
}
