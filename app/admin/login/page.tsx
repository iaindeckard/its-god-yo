"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Staff sign-in — passwordless magic link (signInWithOtp). Reachable without a
 * session (the middleware excludes /admin/login). Authentication only; whether
 * the signed-in user can actually do anything is decided by requirePermission /
 * has_permission — a non-staff email that signs in still gets Forbidden.
 */
export default function AdminLoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    setError(null);
    setBusy(true);
    try {
      const supabase = createClient();
      const next = new URLSearchParams(window.location.search).get("next") || "/admin";
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
      });
      if (error) throw error;
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the link.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 420, margin: "0 auto", padding: "72px 24px" }}>
      <h1 style={{ fontSize: 26, marginBottom: 6 }}>Staff sign in</h1>
      <p className="muted" style={{ marginBottom: 24 }}>
        Enter your staff email and we&rsquo;ll send a magic link — no password. Only authorized staff can access the admin.
      </p>

      {sent ? (
        <div className="card">
          <p className="strong" style={{ fontSize: 18, marginBottom: 6 }}>Check your email 📬</p>
          <p className="muted">
            We sent a sign-in link to <strong>{email}</strong>. Click it to finish signing in.
          </p>
        </div>
      ) : (
        <div className="card">
          {error && <div className="error">{error}</div>}
          <div className="field">
            <label>Staff email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@itsgodyo.com"
              onKeyDown={(e) => {
                if (e.key === "Enter" && email.trim() && !busy) send();
              }}
            />
          </div>
          <button className="btn btn-primary" onClick={send} disabled={busy || !email.trim()}>
            {busy ? "Sending…" : "Send magic link"}
          </button>
        </div>
      )}
    </main>
  );
}
