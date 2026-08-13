"use client";

/**
 * Referral directory (phase 1 of inter-agency referral): the agencies around
 * this tenant — county, school district, state — that requests get pointed to
 * when the records aren't ours. Plain contact data; no integration required,
 * which is what makes it work on day one for agencies that will never be
 * Holmes tenants.
 */
import { useState, useTransition } from "react";
import { branding } from "@/config/branding";
import {
  deleteDirectoryEntryAction,
  saveDirectoryEntryAction,
} from "../[agency]/app/(secure)/admin/directory/actions";

export interface DirectoryRow {
  id: string;
  name: string;
  jurisdictionType: string;
  contactEmail: string | null;
  contactPhone: string | null;
  portalUrl: string | null;
  recordTypes: string[];
  notes: string | null;
  /** Linked to a tenant on this deployment (set by the platform operator —
      read-only here). Refer becomes Refer & forward when true. */
  peerLinked?: boolean;
}

const JURISDICTIONS = [
  ["city", "City"],
  ["county", "County"],
  ["state", "State"],
  ["federal", "Federal"],
  ["school_district", "School district"],
  ["special_district", "Special district"],
  ["court", "Court"],
  ["other", "Other"],
] as const;

const EMPTY = {
  id: "",
  name: "",
  jurisdictionType: "county",
  contactEmail: "",
  contactPhone: "",
  portalUrl: "",
  recordTypes: "",
  notes: "",
};

export function DirectoryManager({ agencySlug, rows }: { agencySlug: string; rows: DirectoryRow[] }) {
  const [form, setForm] = useState({ ...EMPTY });
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function edit(r: DirectoryRow) {
    setForm({
      id: r.id,
      name: r.name,
      jurisdictionType: r.jurisdictionType,
      contactEmail: r.contactEmail ?? "",
      contactPhone: r.contactPhone ?? "",
      portalUrl: r.portalUrl ?? "",
      recordTypes: r.recordTypes.join(", "),
      notes: r.notes ?? "",
    });
    setEditing(true);
    setError(null);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await saveDirectoryEntryAction({
        agencySlug,
        id: form.id || undefined,
        name: form.name,
        jurisdictionType: form.jurisdictionType,
        contactEmail: form.contactEmail,
        contactPhone: form.contactPhone,
        portalUrl: form.portalUrl,
        recordTypes: form.recordTypes,
        notes: form.notes,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setForm({ ...EMPTY });
      setEditing(false);
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const res = await deleteDirectoryEntryAction({ agencySlug, id });
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <div>
      <div className="card" style={{ overflow: "hidden" }}>
        <table className="queue">
          <thead>
            <tr>
              <th>Agency</th>
              <th className="hide-sm">Holds</th>
              <th className="hide-sm">Contact</th>
              <th style={{ width: 120 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <div style={{ fontWeight: 600 }}>
                    {r.name}
                    {r.peerLinked && (
                      <span
                        className="tag"
                        style={{ marginLeft: 6, fontSize: "0.68rem" }}
                        title={`This agency runs on the same ${branding.productName} deployment — referrals forward the request directly. Links are managed by the platform operator.`}
                      >
                        ⚡ forwarding
                      </span>
                    )}
                  </div>
                  <div className="muted" style={{ fontSize: "0.78rem" }}>
                    {JURISDICTIONS.find(([v]) => v === r.jurisdictionType)?.[1] ?? r.jurisdictionType}
                  </div>
                </td>
                <td className="hide-sm">
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {r.recordTypes.map((t) => (
                      <span key={t} className="tag">
                        {t}
                      </span>
                    ))}
                    {r.recordTypes.length === 0 && <span className="muted" style={{ fontSize: "0.8rem" }}>—</span>}
                  </div>
                </td>
                <td className="hide-sm" style={{ fontSize: "0.82rem" }}>
                  {r.contactEmail ?? r.portalUrl ?? <span className="muted">none on file</span>}
                </td>
                <td>
                  <span style={{ display: "inline-flex", gap: 6 }}>
                    <button className="btn btn-sm" onClick={() => edit(r)} disabled={pending}>
                      Edit
                    </button>
                    <button className="btn btn-sm btn-ghost" onClick={() => remove(r.id)} disabled={pending}>
                      Remove
                    </button>
                  </span>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="muted" style={{ padding: 18 }}>
                  No agencies yet. Add the ones you most often send people to — county, school
                  district, courts, state agencies.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card card-pad" style={{ marginTop: 14 }}>
        <div className="panel-title">{editing ? "Edit agency" : "Add an agency"}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
          <label style={{ display: "grid", gap: 4 }}>
            <span className="lbl">Name</span>
            <input
              className="field"
              value={form.name}
              placeholder="Riverton Unified School District"
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span className="lbl">Jurisdiction</span>
            <select
              className="field"
              value={form.jurisdictionType}
              onChange={(e) => setForm({ ...form, jurisdictionType: e.target.value })}
            >
              {JURISDICTIONS.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span className="lbl">Records contact email</span>
            <input
              className="field"
              type="email"
              value={form.contactEmail}
              placeholder="records@example.gov"
              onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
            />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span className="lbl">Phone</span>
            <input
              className="field"
              value={form.contactPhone}
              onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
            />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span className="lbl">Records portal URL</span>
            <input
              className="field"
              value={form.portalUrl}
              placeholder="https://…"
              onChange={(e) => setForm({ ...form, portalUrl: e.target.value })}
            />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span className="lbl">What they hold (comma-separated)</span>
            <input
              className="field"
              value={form.recordTypes}
              placeholder="student records, board minutes"
              onChange={(e) => setForm({ ...form, recordTypes: e.target.value })}
            />
          </label>
        </div>
        <label style={{ display: "grid", gap: 4, marginTop: 10 }}>
          <span className="lbl">Notes for staff (optional)</span>
          <input
            className="field"
            value={form.notes}
            placeholder="Ask for the records clerk, not the front office."
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </label>

        {error && (
          <p style={{ color: "var(--overdue)", fontSize: "0.85rem", marginTop: 8 }}>{error}</p>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button className="btn btn-sm btn-primary" onClick={save} disabled={pending || !form.name.trim()}>
            {pending ? "Saving…" : editing ? "Save changes" : "Add agency"}
          </button>
          {editing && (
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => {
                setForm({ ...EMPTY });
                setEditing(false);
              }}
              disabled={pending}
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
