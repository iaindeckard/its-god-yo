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
          <div className={s.operator}>Operated by Deckard Enterprise International, LLC &middot; 2221 N Amarado St, Wichita, KS 67205</div>
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
