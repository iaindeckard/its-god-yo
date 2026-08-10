"use client";
import { useEffect, useState } from "react";

type Item = { id: string; headline: string; body: string | null; attribution: string | null };
export default function SocialProof() {
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => { fetch("/api/social-proof").then((r) => r.json()).then((v) => setItems(v.items ?? [])).catch(() => {}); }, []);
  if (!items.length) return null;
  return <section style={{ padding: "54px 24px", maxWidth: 1080, margin: "0 auto" }}>
    <p className="strong">VERIFIED EXPERIENCES</p><h2>What participating families and churches say</h2>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 16 }}>
      {items.map((item) => <blockquote className="card" key={item.id}><strong>{item.headline}</strong>{item.body && <p>{item.body}</p>}{item.attribution && <footer className="muted">From {item.attribution}</footer>}</blockquote>)}
    </div>
  </section>;
}
