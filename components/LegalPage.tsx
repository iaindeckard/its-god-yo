import Link from "next/link";
import type { ReactNode } from "react";
import Wordmark from "./Wordmark";
import s from "./legal.module.css";

/** Block-level placeholder — renders draft [PLACEHOLDER] copy so it clearly reads
 *  as pending legal review, never as finished text. */
export function Ph({ children, label = "Placeholder — pending legal review" }: { children: ReactNode; label?: string }) {
  return (
    <span className={s.ph}>
      <span className={s.tag}>{label}</span>
      {children}
    </span>
  );
}

/** Inline placeholder token, e.g. a to-be-determined support email. */
export function PhInline({ children }: { children: ReactNode }) {
  return <span className={s.phInline}>{children}</span>;
}

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
          <div className={s.operator}>Operated by Deckard Enterprise International, LLC &middot; 2221 N Amarado St, Wichita, KS 67205</div>
        </div>
        <div className={s.draft}>
          <span className={s.dot}>&#9888;</span>
          <p>This is a <strong>draft pending attorney review</strong> and is not yet final. The highlighted sections below are placeholders awaiting legal confirmation and are not binding.</p>
        </div>
        <div className={s.prose}>{children}</div>
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
