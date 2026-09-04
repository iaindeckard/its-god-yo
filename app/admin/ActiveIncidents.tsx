"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Incident } from "@/lib/landing";

/** Active-incidents panel with per-row and bulk acknowledge. Acknowledging flips
 *  igy_alert_state.resolved=true so the row leaves the list; if the underlying
 *  condition is still real, the next monitor run re-fires it. Dismiss controls
 *  render only when the operator can ack (super_admin); everyone else sees the
 *  read-only panel as before. */
export default function ActiveIncidents({ incidents, canAck }: { incidents: Incident[]; canAck: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function ack(payload: object, key: string) {
    setBusy(key); setErr(null);
    try {
      const res = await fetch("/api/admin/incidents/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(data.error || "Failed to dismiss"); return; }
      router.refresh();
    } catch {
      setErr("Failed to dismiss");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="incidents">
      <div className="incidents-head">
        <span>🚨 Active incidents ({incidents.length})</span>
        {canAck && (
          <button
            className="btn btn-ghost incident-ack"
            disabled={busy !== null}
            onClick={() => ack({ all: true }, "__all__")}
          >
            {busy === "__all__" ? "…" : "Dismiss all"}
          </button>
        )}
      </div>
      {err && <div className="error" style={{ margin: "4px 0" }}>{err}</div>}
      {incidents.map((i) => {
        const key = `${i.alert_type}:${i.entity_key}`;
        return (
          <div key={key} className="incident-row">
            <div>
              <span className="incident-type">{i.alert_type.replace(/[-_]/g, " ")}</span>
              {i.last_message && <span className="incident-msg"> — {i.last_message}</span>}
            </div>
            <div className="incident-right">
              <span className="incident-meta">
                fired {i.fire_count}×{i.last_fired_at ? ` · ${new Date(i.last_fired_at).toLocaleString()}` : ""}
              </span>
              {canAck && (
                <button
                  className="btn btn-ghost incident-ack"
                  disabled={busy !== null}
                  onClick={() => ack({ alertType: i.alert_type, entityKey: i.entity_key }, key)}
                >
                  {busy === key ? "…" : "Dismiss"}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
