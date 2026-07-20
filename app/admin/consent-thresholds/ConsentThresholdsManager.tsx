"use client";

import { useState } from "react";
import type { ThresholdRow } from "@/lib/consentThresholds";

export default function ConsentThresholdsManager({ initial }: { initial: ThresholdRow[] }) {
  const [rows, setRows] = useState<ThresholdRow[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [newCountry, setNewCountry] = useState("");

  async function addCountry() {
    setError(null);
    const res = await fetch("/api/admin/consent-thresholds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ country_code: newCountry }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error || "Failed"); return; }
    setRows((r) => [...r, data.threshold].sort((a, b) => a.country_code.localeCompare(b.country_code)));
    setNewCountry("");
  }

  return (
    <>
      <div className="admin-head">
        <h1>Age-consent thresholds</h1>
      </div>
      <div className="admin-note">
        <strong>Fail-safe by design.</strong> Every country stays <em>attorney-confirmed = false</em> at the strictest
        default (16) until counsel confirms it here. While a country is unconfirmed, the signup flow blocks anyone
        computed under 16 in that country. Only mark a country confirmed with a real attorney sign-off — this table is
        the single source of truth and needs no code deploy to change.
      </div>
      {error && <div className="error">{error}</div>}

      <table className="table">
        <thead>
          <tr>
            <th>Country</th><th>Min age</th><th>Attorney confirmed</th><th>Confirmed by</th>
            <th>Required mechanism</th><th>Notes</th><th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <EditableRow key={row.country_code} row={row} onSaved={(u) => setRows((rs) => rs.map((r) => (r.country_code === u.country_code ? u : r)))} onError={setError} />
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: 16, display: "flex", gap: 8, alignItems: "center" }}>
        <input
          value={newCountry}
          onChange={(e) => setNewCountry(e.target.value.toUpperCase().slice(0, 2))}
          placeholder="ISO code (e.g. CA)"
          style={{ maxWidth: 160, padding: "10px 12px", border: "1.5px solid var(--igy-line)", borderRadius: 10 }}
        />
        <button className="btn btn-ghost" disabled={newCountry.length !== 2} onClick={addCountry}>+ Add country (unconfirmed)</button>
      </div>
    </>
  );
}

function EditableRow({
  row,
  onSaved,
  onError,
}: {
  row: ThresholdRow;
  onSaved: (u: ThresholdRow) => void;
  onError: (m: string) => void;
}) {
  const [minAge, setMinAge] = useState(String(row.minimum_age_for_self_consent));
  const [confirmed, setConfirmed] = useState(row.attorney_confirmed);
  const [confirmedBy, setConfirmedBy] = useState(row.attorney_confirmed_by ?? "");
  const [mechanism, setMechanism] = useState(row.required_consent_mechanism ?? "");
  const [notes, setNotes] = useState(row.notes ?? "");
  const [busy, setBusy] = useState(false);

  const dirty =
    minAge !== String(row.minimum_age_for_self_consent) ||
    confirmed !== row.attorney_confirmed ||
    confirmedBy !== (row.attorney_confirmed_by ?? "") ||
    mechanism !== (row.required_consent_mechanism ?? "") ||
    notes !== (row.notes ?? "");

  async function save() {
    onError("");
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/consent-thresholds/${row.country_code}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          minimum_age_for_self_consent: Number(minAge),
          attorney_confirmed: confirmed,
          attorney_confirmed_by: confirmedBy,
          required_consent_mechanism: mechanism,
          notes,
        }),
      });
      const data = await res.json();
      if (!res.ok) { onError(data.error || "Save failed"); return; }
      onSaved(data.threshold);
    } finally {
      setBusy(false);
    }
  }

  const inputStyle = { width: "100%", padding: "7px 9px", border: "1.5px solid var(--igy-line)", borderRadius: 8, fontSize: 13 } as const;

  return (
    <tr>
      <td className="mono" style={{ fontWeight: 700 }}>
        {row.country_code}
        {confirmed ? <span className="pill pill-on" style={{ marginLeft: 6 }}>confirmed</span> : <span className="pill pill-warn" style={{ marginLeft: 6 }}>unconfirmed</span>}
      </td>
      <td style={{ width: 80 }}><input type="number" value={minAge} onChange={(e) => setMinAge(e.target.value)} style={inputStyle} min={0} max={25} /></td>
      <td style={{ textAlign: "center" }}><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} style={{ width: 18, height: 18 }} /></td>
      <td><input value={confirmedBy} onChange={(e) => setConfirmedBy(e.target.value)} placeholder="attorney name/ref" style={inputStyle} /></td>
      <td><input value={mechanism} onChange={(e) => setMechanism(e.target.value)} placeholder="e.g. verifiable_parental_consent_v1" style={inputStyle} /></td>
      <td><input value={notes} onChange={(e) => setNotes(e.target.value)} style={inputStyle} /></td>
      <td><button className="btn btn-primary" style={{ padding: "6px 12px", fontSize: 13 }} disabled={!dirty || busy} onClick={save}>{busy ? "…" : "Save"}</button></td>
    </tr>
  );
}
