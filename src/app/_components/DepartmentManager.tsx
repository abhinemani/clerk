"use client";

/**
 * Department manager (onboarding): the custodians dispatch routes tasks to.
 * Create and edit only — departments are referenced by tasks, routing rules,
 * and responder accounts, so history must keep resolving; there is no delete.
 */
import { useState, useTransition } from "react";
import { saveDepartmentAction } from "../[agency]/app/(secure)/admin/actions";

export interface DepartmentRow {
  id: string;
  name: string;
  responderEmails: string[];
}

export function DepartmentManager({
  agencySlug,
  rows,
}: {
  agencySlug: string;
  rows: DepartmentRow[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [emails, setEmails] = useState("");

  function startEdit(row: DepartmentRow | null) {
    setEditingId(row?.id ?? "new");
    setName(row?.name ?? "");
    setEmails(row?.responderEmails.join(", ") ?? "");
    setError(null);
  }

  function save() {
    startTransition(async () => {
      const result = await saveDepartmentAction({
        agencySlug,
        id: editingId === "new" ? undefined : (editingId ?? undefined),
        name,
        responderEmails: emails,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditingId(null);
    });
  }

  return (
    <div className="stack" style={{ gap: 12 }}>
      {error && (
        <p className="pill band-overdue" role="alert" style={{ justifySelf: "start" }}>
          {error}
        </p>
      )}

      <div className="card" style={{ overflow: "hidden" }}>
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {rows.map((d) => (
            <li key={d.id} style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
              {editingId === d.id ? (
                <DeptForm
                  name={name}
                  emails={emails}
                  pending={pending}
                  onName={setName}
                  onEmails={setEmails}
                  onSave={save}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div style={{ fontWeight: 600 }}>{d.name}</div>
                    <div className="muted" style={{ fontSize: "0.8rem" }}>
                      {d.responderEmails.length > 0
                        ? d.responderEmails.join(", ")
                        : "No responder email — task links must be shared by hand"}
                    </div>
                  </div>
                  <button className="btn btn-sm btn-ghost" disabled={pending} onClick={() => startEdit(d)}>
                    Edit
                  </button>
                </div>
              )}
            </li>
          ))}
          {rows.length === 0 && editingId !== "new" && (
            <li className="muted" style={{ padding: 16, fontSize: "0.9rem" }}>
              No departments yet — dispatch has nowhere to send a task until you add one.
            </li>
          )}
          {editingId === "new" && (
            <li style={{ padding: "12px 16px" }}>
              <DeptForm
                name={name}
                emails={emails}
                pending={pending}
                onName={setName}
                onEmails={setEmails}
                onSave={save}
                onCancel={() => setEditingId(null)}
              />
            </li>
          )}
        </ul>
      </div>

      {editingId !== "new" && (
        <div>
          <button className="btn btn-sm" disabled={pending} onClick={() => startEdit(null)}>
            Add a department…
          </button>
        </div>
      )}
    </div>
  );
}

function DeptForm(props: {
  name: string;
  emails: string;
  pending: boolean;
  onName: (v: string) => void;
  onEmails: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      <label style={{ display: "grid", gap: 4 }}>
        <span className="lbl">Department name</span>
        <input
          className="field"
          value={props.name}
          placeholder="Public Works"
          onChange={(e) => props.onName(e.target.value)}
        />
      </label>
      <label style={{ display: "grid", gap: 4 }}>
        <span className="lbl">Responder emails (comma-separated, optional)</span>
        <input
          className="field"
          value={props.emails}
          placeholder="records@publicworks.gov"
          onChange={(e) => props.onEmails(e.target.value)}
        />
        <span className="muted" style={{ fontSize: "0.78rem" }}>
          Dispatched tasks email a no-login fulfill link here. Responders with accounts also see
          tasks under their own login.
        </span>
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-sm btn-primary" disabled={props.pending || !props.name.trim()} onClick={props.onSave}>
          {props.pending ? "Saving…" : "Save department"}
        </button>
        <button className="btn btn-sm btn-ghost" disabled={props.pending} onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
