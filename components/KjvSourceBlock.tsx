/**
 * Canonical KJV source text shown next to the AI reword outputs in the review
 * surfaces, so a reviewer can judge whether a reword is faithful / complete
 * against the verse it's rewording — not from the reference alone.
 */
export default function KjvSourceBlock({ text }: { text: string | null }) {
  return (
    <div
      style={{
        marginTop: 12,
        padding: "10px 12px",
        background: "var(--igy-bg-alt)",
        border: "1px solid var(--igy-line)",
        borderLeft: "3px solid var(--igy-line)",
        borderRadius: 8,
      }}
    >
      <div className="muted" style={{ fontSize: 12, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>
        Canonical source · KJV
      </div>
      <div style={{ fontSize: 14, lineHeight: 1.5 }}>
        {text ?? <em className="muted">source text not found for this reference</em>}
      </div>
    </div>
  );
}
