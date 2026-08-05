"use client";

import { useState, useTransition } from "react";
import {
  addStaffMember,
  setStaffDepartmentsAction,
  setStaffRole,
} from "../[agency]/app/(secure)/admin/actions";
import { Avatar } from "./ui";

export interface RosterRow {
  id: string;
  email: string;
  name: string | null;
  role: string;
  isSelf: boolean;
  hasPassword: boolean;
  /** Departments this member belongs to (drives a responder's task view). */
  departmentIds: string[];
}

const ROLES = ["admin", "coordinator", "reviewer", "responder", "read_only"] as const;
type Role = (typeof ROLES)[number];

const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  coordinator: "Coordinator",
  reviewer: "Reviewer",
  responder: "Responder",
  read_only: "Read-only",
};

/** Agency-admin roster: list staff, change roles and departments, add a member. */
export function StaffRoster({
  agencySlug,
  rows,
  departments = [],
}: {
  agencySlug: string;
  rows: RosterRow[];
  /** The agency's departments — membership targets for responders. */
  departments?: { id: string; name: string }[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggleDepartment(row: RosterRow, departmentId: string) {
    const next = row.departmentIds.includes(departmentId)
      ? row.departmentIds.filter((id) => id !== departmentId)
      : [...row.departmentIds, departmentId];
    setError(null);
    startTransition(async () => {
      const result = await setStaffDepartmentsAction({ agencySlug, userId: row.id, departmentIds: next });
      if (!result.ok) setError(result.error);
    });
  }

  // Add-member form state
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("coordinator");
  const [password, setPassword] = useState("");
  const [added, setAdded] = useState<string | null>(null);

  function changeRole(userId: string, newRole: Role) {
    setError(null);
    startTransition(async () => {
      const result = await setStaffRole({ agencySlug, userId, role: newRole });
      if (!result.ok) setError(result.error);
    });
  }

  function onAdd(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    setAdded(null);
    startTransition(async () => {
      const result = await addStaffMember({ agencySlug, email, name, role, password: password || undefined });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setAdded(
        password
          ? `${name || email} added as ${ROLE_LABEL[role].toLowerCase()}.`
          : `${name || email} invited as ${ROLE_LABEL[role].toLowerCase()} — the invite link is in the outbox.`,
      );
      setName("");
      setEmail("");
      setPassword("");
    });
  }

  return (
    <div className="stack" style={{ gap: 20 }}>
      {error && (
        <p className="pill band-overdue" role="alert" style={{ justifySelf: "start" }}>
          {error}
        </p>
      )}

      <div className="card" style={{ overflow: "hidden" }}>
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {rows.map((u) => (
            <li
              key={u.id}
              style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}
            >
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <Avatar name={u.name ?? u.email} tone="primary" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>
                    {u.name ?? u.email}
                    {u.isSelf && (
                      <span className="muted" style={{ fontWeight: 400 }}>
                        {" "}
                        (you)
                      </span>
                    )}
                  </div>
                  <div className="muted" style={{ fontSize: "0.82rem" }}>
                    {u.email}
                    {!u.hasPassword && " · no password set"}
                  </div>
                </div>
                <select
                  className="field"
                  style={{ width: "auto", paddingBlock: 7 }}
                  value={u.role}
                  disabled={pending || u.isSelf}
                  onChange={(e) => changeRole(u.id, e.target.value as Role)}
                  aria-label={`Role for ${u.name ?? u.email}`}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
              </div>
              {/* Department membership — a responder's task view IS this list. */}
              {u.role === "responder" && departments.length > 0 && (
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 10, paddingLeft: 44 }}>
                  <span className="lbl">Departments</span>
                  {departments.map((d) => {
                    const on = u.departmentIds.includes(d.id);
                    return (
                      <label
                        key={d.id}
                        className="tag"
                        style={{ cursor: "pointer", display: "inline-flex", gap: 5, alignItems: "center", opacity: pending ? 0.6 : 1 }}
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={pending}
                          onChange={() => toggleDepartment(u, d.id)}
                          style={{ margin: 0 }}
                        />
                        {d.name}
                      </label>
                    );
                  })}
                  {u.departmentIds.length === 0 && (
                    <span className="muted" style={{ fontSize: "0.78rem" }}>
                      — no departments yet; they&apos;ll see an empty task list
                    </span>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>

      <form onSubmit={onAdd} className="card card-pad stack" style={{ gap: 14 }}>
        <div className="panel-title">Add a staff member</div>
        <div className="roster-grid">
          <div className="stack" style={{ gap: 6 }}>
            <label className="lbl" htmlFor="r-name">
              Name
            </label>
            <input id="r-name" className="field" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <label className="lbl" htmlFor="r-email">
              Email
            </label>
            <input id="r-email" type="email" className="field" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <label className="lbl" htmlFor="r-role">
              Role
            </label>
            <select id="r-role" className="field" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <label className="lbl" htmlFor="r-pass">
              Initial password{" "}
              <span className="muted" style={{ fontWeight: 400 }}>
                (optional)
              </span>
            </label>
            <input
              id="r-pass"
              type="text"
              className="field"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Leave blank to send an invite link"
            />
          </div>
        </div>
        {added && <p className="pill band-on_track" style={{ justifySelf: "start" }}>{added}</p>}
        <div>
          <button className="btn btn-primary" type="submit" disabled={pending}>
            {pending ? "Adding…" : "Add staff member"}
          </button>
        </div>
        <style>{`
          .roster-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
          @media (max-width: 640px) { .roster-grid { grid-template-columns: 1fr; } }
        `}</style>
      </form>
    </div>
  );
}
