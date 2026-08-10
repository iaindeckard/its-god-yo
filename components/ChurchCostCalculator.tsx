"use client";
import { useState } from "react";

export default function ChurchCostCalculator() {
  const [teens, setTeens] = useState(15);
  const perTeen = teens <= 50 ? 28 : teens <= 150 ? 32 : teens <= 300 ? 36 : null;
  return <div className="card" style={{ marginBottom: 24 }}>
    <h2 style={{ marginTop: 0 }}>Estimate your youth-group rollout</h2>
    <label className="field">Number of teens<input type="number" min={1} max={250} value={teens} onChange={(e) => setTeens(Math.max(1, Number(e.target.value) || 1))} /></label>
    <p><strong>{perTeen ? `Planning estimate: $${(teens * perTeen).toLocaleString()}/year` : "Let’s design a rollout for 301+ recipients."}</strong></p>
    <p className="muted">{perTeen ? `$${perTeen}/recipient/year at this size. ` : ""}This is a planning estimate, not a quote; the church can sponsor the group or families can enroll individually.</p>
  </div>;
}
