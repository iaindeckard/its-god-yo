"use client";

import { useMemo, useState } from "react";
import type { RolesCatalog, JobRole, Permission, RolePermission, StaffRow } from "@/lib/roleAdmin";

const LOCKED_ROLE = "super_admin"; // its permission set can't be edited (data-driven authz would lock everyone out)

export default function RolesManager({ initialCatalog }: { initialCatalog: RolesCatalog }) {
  const [roles, setRoles] = useState<JobRole[]>(initialCatalog.roles);
  const [permissions] = useState<Permission[]>(initialCatalog.permissions);
  const [rolePerms, setRolePerms] = useState<RolePermission[]>(initialCatalog.rolePermissions);
  const [staff, setStaff] = useState<StaffRow[]>(initialCatalog.staff);

  const [tab, setTab] = useState<"roles" | "staff">("roles");
  const [selectedRole, setSelectedRole] = useState<string>(initialCatalog.roles[0]?.key ?? "");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const flash = (msg: string) => { setError(null); setNote(msg); };
  const fail = (e: unknown) => { setNote(null); setError(e instanceof Error ? e.message : String(e)); };

  // add-role form
  const [nrLabel, setNrLabel] = useState("");
  const [nrKey, setNrKey] = useState("");
  const [nrDesc, setNrDesc] = useState("");
  // edit-role form (mirrors the selected role)
  const selected = roles.find((r) => r.key === selectedRole) ?? null;
  const [editLabel, setEditLabel] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const selectRole = (key: string) => {
    setSelectedRole(key);
    const r = roles.find((x) => x.key === key);
    setEditLabel(r?.label ?? "");
    setEditDesc(r?.description ?? "");
  };
  // onboarding form
  const [obEmail, setObEmail] = useState("");
  const [obRole, setObRole] = useState(initialCatalog.roles.find((r) => r.key !== LOCKED_ROLE)?.key ?? initialCatalog.roles[0]?.key ?? "");

  const categories = useMemo(() => {
    const seen: string[] = [];
    for (const p of permissions) { const c = p.category ?? "other"; if (!seen.includes(c)) seen.push(c); }
    return seen;
  }, [permissions]);

  const isEnabled = (role: string, permKey: string) =>
    rolePerms.find((rp) => rp.job_role === role && rp.permission_key === permKey)?.enabled ?? false;

  const enabledCount = (role: string) => permissions.filter((p) => isEnabled(role, p.key)).length;

  async function reloadCatalog() {
    const d = await (await fetch("/api/admin/roles")).json();
    if (d.roles) { setRoles(d.roles); setRolePerms(d.rolePermissions); setStaff(d.staff); }
  }

  async function togglePerm(role: string, permKey: string) {
    if (role === LOCKED_ROLE) return;
    const next = !isEnabled(role, permKey);
    // optimistic
    setRolePerms((prev) => {
      const i = prev.findIndex((rp) => rp.job_role === role && rp.permission_key === permKey);
      if (i === -1) return [...prev, { job_role: role, permission_key: permKey, enabled: next }];
      const copy = [...prev]; copy[i] = { ...copy[i], enabled: next }; return copy;
    });
    try {
      const res = await fetch("/api/admin/roles/permissions", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_role: role, permission_key: permKey, enabled: next }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "toggle failed");
      setNote(null);
    } catch (e) { fail(e); reloadCatalog(); }
  }

  async function addRole() {
    try {
      const res = await fetch("/api/admin/roles", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: nrKey || nrLabel, label: nrLabel, description: nrDesc }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "create failed");
      setNrLabel(""); setNrKey(""); setNrDesc("");
      await reloadCatalog();
      selectRole(d.role.key);
      flash(`Role "${d.role.label}" created.`);
    } catch (e) { fail(e); }
  }

  async function saveRole() {
    if (!selected) return;
    try {
      const res = await fetch("/api/admin/roles", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: selected.key, label: editLabel, description: editDesc }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "save failed");
      setRoles((prev) => prev.map((r) => (r.key === selected.key ? d.role : r)));
      flash(`Role "${d.role.label}" updated.`);
    } catch (e) { fail(e); }
  }

  async function onboard() {
    try {
      const res = await fetch("/api/admin/staff", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: obEmail, job_role: obRole }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "onboarding failed");
      setObEmail("");
      await reloadCatalog();
      flash(`${d.staff.email} onboarded as ${roles.find((r) => r.key === d.staff.job_role)?.label ?? d.staff.job_role}${d.auth_user_created ? " (new account created; they sign in at /admin/login)" : " (existing account)"}.`);
    } catch (e) { fail(e); }
  }

  const roleLabel = (key: string | null) => roles.find((r) => r.key === key)?.label ?? key ?? "N/A";

  return (
    <>
      <div className="admin-head">
        <h1>Roles &amp; staff</h1>
        <span className="dev-badge">admin.roles.manage</span>
      </div>
      <p className="muted" style={{ marginTop: -12, marginBottom: 18 }}>
        Roles, their permission sets, and staff onboarding. Everything here reads and writes the live RBAC tables, so
        changes take effect immediately (no redeploy).
      </p>

      {error && <div className="error">{error}</div>}
      {note && <div className="admin-note">{note}</div>}

      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <button className={`btn ${tab === "roles" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("roles")}>Roles &amp; permissions</button>
        <button className={`btn ${tab === "staff" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("staff")}>Staff ({staff.length})</button>
      </div>

      {tab === "roles" ? (
        <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 24, alignItems: "start" }}>
          {/* role list + add */}
          <div>
            <div className="card" style={{ padding: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--igy-slate)", marginBottom: 8 }}>Roles ({roles.length})</div>
              {roles.map((r) => (
                <button key={r.key} onClick={() => selectRole(r.key)}
                  style={{ display: "block", width: "100%", textAlign: "left", border: "none", background: selectedRole === r.key ? "var(--igy-blue-tint)" : "transparent", color: selectedRole === r.key ? "var(--igy-blue)" : "var(--igy-ink)", cursor: "pointer", padding: "8px 10px", borderRadius: 6, fontWeight: selectedRole === r.key ? 700 : 500, fontSize: 14 }}>
                  {r.label} <span style={{ color: "var(--igy-slate)", fontWeight: 400, fontSize: 12 }}>· {r.key === LOCKED_ROLE ? "all" : enabledCount(r.key)}</span>
                </button>
              ))}
            </div>
            <div className="card" style={{ padding: 14, marginTop: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--igy-slate)", marginBottom: 8 }}>Add a role</div>
              <div className="field" style={{ marginBottom: 8 }}><input value={nrLabel} onChange={(e) => setNrLabel(e.target.value)} placeholder="Label (e.g. Content Lead)" /></div>
              <div className="field" style={{ marginBottom: 8 }}><input value={nrKey} onChange={(e) => setNrKey(e.target.value)} placeholder="key (optional, e.g. content_lead)" /></div>
              <div className="field" style={{ marginBottom: 10 }}><input value={nrDesc} onChange={(e) => setNrDesc(e.target.value)} placeholder="Description (optional)" /></div>
              <button className="btn btn-primary" style={{ width: "100%" }} disabled={!nrLabel.trim()} onClick={addRole}>+ Create role</button>
            </div>
          </div>

          {/* selected role: edit + permission grid */}
          <div>
            {selected && (
              <>
                <div className="card" style={{ marginBottom: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                    <div>
                      <h2 style={{ margin: 0, fontSize: 20 }}>{selected.label}</h2>
                      <code style={{ fontSize: 12, color: "var(--igy-slate)" }}>{selected.key}</code>
                    </div>
                    <span className="muted" style={{ fontSize: 13 }}>{selected.key === LOCKED_ROLE ? `${permissions.length} of ${permissions.length}` : `${enabledCount(selected.key)} of ${permissions.length}`} permissions</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr auto", gap: 10, marginTop: 12, alignItems: "end" }}>
                    <div className="field"><label>Label</label><input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} /></div>
                    <div className="field"><label>Description</label><input value={editDesc} onChange={(e) => setEditDesc(e.target.value)} /></div>
                    <button className="btn btn-ghost" disabled={!editLabel.trim()} onClick={saveRole}>Save</button>
                  </div>
                </div>

                <div className="card">
                  {selected.key === LOCKED_ROLE && (
                    <div className="admin-note" style={{ marginBottom: 14 }}>Super Admin keeps every permission and can&rsquo;t be edited here, so it can never be locked out of the system.</div>
                  )}
                  {categories.map((cat) => (
                    <div key={cat} style={{ marginBottom: 18 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--igy-blue)", marginBottom: 8 }}>{cat}</div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "4px 16px" }}>
                        {permissions.filter((p) => (p.category ?? "other") === cat).map((p) => {
                          const on = selected.key === LOCKED_ROLE ? true : isEnabled(selected.key, p.key);
                          return (
                            <label key={p.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, padding: "3px 0", cursor: selected.key === LOCKED_ROLE ? "default" : "pointer", opacity: selected.key === LOCKED_ROLE ? 0.75 : 1 }}>
                              <input type="checkbox" checked={on} disabled={selected.key === LOCKED_ROLE} onChange={() => togglePerm(selected.key, p.key)} />
                              <span>{p.label} <code style={{ fontSize: 11, color: "var(--igy-slate)" }}>{p.key}</code></span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 24, alignItems: "start" }}>
          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--igy-slate)", marginBottom: 10 }}>Onboard a staff member</div>
            <div className="field" style={{ marginBottom: 10 }}>
              <label>Email</label>
              <input type="email" value={obEmail} onChange={(e) => setObEmail(e.target.value)} placeholder="name@itsgodyo.com" />
            </div>
            <div className="field" style={{ marginBottom: 12 }}>
              <label>Role / title</label>
              <select value={obRole} onChange={(e) => setObRole(e.target.value)}>
                {roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
            </div>
            <button className="btn btn-primary" style={{ width: "100%" }} disabled={!obEmail.trim() || !obRole} onClick={onboard}>Add staff member</button>
            <p className="muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
              Creates their staff record and (if needed) an account for that email. They sign in at /admin/login with a magic link; their role decides what they can access.
            </p>
          </div>

          <div className="card">
            <h2 style={{ margin: "0 0 12px", fontSize: 18 }}>Staff ({staff.length})</h2>
            <div className="sim-scroll">
              <table className="table">
                <thead><tr><th>Email</th><th>Role</th><th>Status</th><th>Added</th></tr></thead>
                <tbody>
                  {staff.length === 0 && <tr><td colSpan={4} className="muted">No staff yet.</td></tr>}
                  {staff.map((s) => (
                    <tr key={s.user_id}>
                      <td>{s.email ?? <span className="muted">{s.user_id.slice(0, 8)}…</span>}</td>
                      <td>{roleLabel(s.job_role)}</td>
                      <td>{s.is_active ? "Active" : <span style={{ color: "var(--igy-error-text)" }}>Inactive</span>}</td>
                      <td className="muted">{new Date(s.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
