"use client";

import { useState } from "react";

interface Defaults {
  verseRef: string;
  themeTrack: string;
  reportDate: string;
  reportedText: string;
}

export default function ReportForm({ defaults }: { defaults: Defaults }) {
  const [email, setEmail] = useState("");
  const [verseRef, setVerseRef] = useState(defaults.verseRef);
  const [reportDate, setReportDate] = useState(defaults.reportDate);
  const [reportedText, setReportedText] = useState(defaults.reportedText);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    setError(null); setBusy(true);
    try {
      const res = await fetch("/api/report-issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reporter_email: email,
          verse_ref: verseRef,
          theme_track: defaults.themeTrack,
          report_date: reportDate,
          reported_text: reportedText || undefined,
          description,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Something went wrong");
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally { setBusy(false); }
  }

  const valid = email.trim() && verseRef.trim() && reportDate.trim() && description.trim();

  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Report an issue</h1>
      <p className="muted" style={{ marginBottom: 24 }}>
        See a translation or wording that seems off in one of your daily texts? Tell us what&rsquo;s wrong. A person
        reviews every report. If it&rsquo;s confirmed, the <strong>first person</strong> to report it earns a $6.99
        account credit (max one credit per person per month).
      </p>

      {done ? (
        <div className="card">
          <p className="strong" style={{ fontSize: 18, marginBottom: 6 }}>Thanks — got it. 🙏</p>
          <p className="muted">
            Your report is in the review queue. Nothing pays out automatically; a human confirms real issues first. If
            yours is confirmed and you were the first to report it, a credit will be earned to your account.
          </p>
          <a className="btn btn-ghost" href="/" style={{ marginTop: 16 }}>Back home</a>
        </div>
      ) : (
        <div className="card">
          {error && <div className="error">{error}</div>}
          <div className="field">
            <label>Your email (the one on the account)</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>
          <div className="row">
            <div className="field">
              <label>Verse reference</label>
              <input value={verseRef} onChange={(e) => setVerseRef(e.target.value)} placeholder="Isaiah 50:7" />
            </div>
            <div className="field">
              <label>Date of the text</label>
              <input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label>The specific text that&rsquo;s wrong (optional)</label>
            <input value={reportedText} onChange={(e) => setReportedText(e.target.value)} placeholder="paste the part that reads wrong" />
          </div>
          <div className="field">
            <label>What&rsquo;s wrong with it?</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="Mistranslation, tone miss, factual error, typo…" />
          </div>
          <button className="btn btn-primary" onClick={submit} disabled={!valid || busy}>
            {busy ? "Sending…" : "Submit report"}
          </button>
        </div>
      )}
    </main>
  );
}
