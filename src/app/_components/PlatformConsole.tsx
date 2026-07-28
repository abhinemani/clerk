"use client";

import { useState, useTransition } from "react";
import {
  createAgencyAction,
  platformResetPassword,
  platformSetStaffRole,
  platformSignIn,
} from "../admin/actions";
import { Avatar } from "./ui";

// --- operator sign-in ------------------------------------------------------

export function PlatformLoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const r = await platformSignIn({ email, password });
          if (!r.ok) setError(r.error);
        });
      }}
      className="card card-pad stack"
      style={{ gap: 16 }}
    >
      <div className="stack" style={{ gap: 6 }}>
        <label className="lbl" htmlFor="p-email">
          Operator email
        </label>
        <input id="p-email" type="email" className="field" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <label className="lbl" htmlFor="p-pass">
          Password
        </label>
        <input id="p-pass" type="password" className="field" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {error && (
        <p className="pill band-overdue" role="alert" style={{ justifySelf: "start" }}>
          {error}
        </p>
      )}
      <div>
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? "One moment…" : "Sign in"}
        </button>
      </div>
    </form>
  );
}

// --- onboard a new agency --------------------------------------------------

export function CreateAgencyForm() {
  const [form, setForm] = useState({
    name: "",
    slug: "",
    stateCode: "CA",
    adminName: "",
    adminEmail: "",
    adminPassword: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        setDone(null);
        startTransition(async () => {
          const r = await createAgencyAction(form);
          if (!r.ok) {
            setError(r.error);
            return;
          }
          setDone(`${form.name} is live at /${form.slug} — the admin can sign in at /${form.slug}/app/login.`);
          setForm({ name: "", slug: "", stateCode: "CA", adminName: "", adminEmail: "", adminPassword: "" });
        });
      }}
      className="card card-pad stack"
      style={{ gap: 14 }}
    >
      <div className="panel-title">Onboard a government</div>
      <div className="pc-grid">
        <div className="stack" style={{ gap: 6 }}>
          <label className="lbl" htmlFor="a-name">
            Agency name
          </label>
          <input id="a-name" className="field" required placeholder="City of Bellmar" value={form.name} onChange={set("name")} />
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <label className="lbl" htmlFor="a-slug">
            URL slug
          </label>
          <input id="a-slug" className="field" required placeholder="bellmar" value={form.slug} onChange={set("slug")} />
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <label className="lbl" htmlFor="a-state">
            State (statute profile)
          </label>
          <select id="a-state" className="field" value={form.stateCode} onChange={set("stateCode")}>
            {["CA", "TX", "IL", "WA", "NY"].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <label className="lbl" htmlFor="a-admin-name">
            First admin — name
          </label>
          <input id="a-admin-name" className="field" required value={form.adminName} onChange={set("adminName")} />
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <label className="lbl" htmlFor="a-admin-email">
            First admin — email
          </label>
          <input id="a-admin-email" type="email" className="field" required value={form.adminEmail} onChange={set("adminEmail")} />
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <label className="lbl" htmlFor="a-admin-pass">
            First admin — password
          </label>
          <input id="a-admin-pass" type="text" className="field" required minLength={8} value={form.adminPassword} onChange={set("adminPassword")} />
        </div>
      </div>
      {error && (
        <p className="pill band-overdue" role="alert" style={{ justifySelf: "start" }}>
          {error}
        </p>
      )}
      {done && (
        <p className="pill band-on_track" style={{ justifySelf: "start" }}>
          {done}
        </p>
      )}
      <div>
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create agency"}
        </button>
      </div>
      <style>{`
        .pc-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
        @media (max-width: 760px) { .pc-grid { grid-template-columns: 1fr; } }
      `}</style>
    </form>
  );
}

// --- per-tenant account management ----------------------------------------

export interface PlatformStaffRow {
  id: string;
  email: string;
  name: string | null;
  role: string;
  hasPassword: boolean;
}

const ROLES = ["admin", "coordinator", "reviewer", "responder", "read_only"] as const;

export function PlatformStaffTable({
  agencyId,
  agencySlug,
  rows,
}: {
  agencyId: string;
  agencySlug: string;
  rows: PlatformStaffRow[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="stack" style={{ gap: 12 }}>
      {error && (
        <p className="pill band-overdue" role="alert" style={{ justifySelf: "start" }}>
          {error}
        </p>
      )}
      {notice && (
        <p className="pill band-on_track" style={{ justifySelf: "start" }}>
          {notice}
        </p>
      )}
      <div className="card" style={{ overflow: "hidden" }}>
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {rows.map((u) => (
            <li
              key={u.id}
              style={{ display: "flex", gap: 12, alignItems: "center", padding: "13px 16px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}
            >
              <Avatar name={u.name ?? u.email} tone="primary" />
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ fontWeight: 600 }}>{u.name ?? u.email}</div>
                <div className="muted" style={{ fontSize: "0.82rem" }}>
                  {u.email}
                  {!u.hasPassword && " · no password set"}
                </div>
              </div>
              <select
                className="field"
                style={{ width: "auto", paddingBlock: 6 }}
                value={u.role}
                disabled={pending}
                aria-label={`Role for ${u.email}`}
                onChange={(e) => {
                  setError(null);
                  setNotice(null);
                  startTransition(async () => {
                    const r = await platformSetStaffRole({ agencyId, agencySlug, userId: u.id, role: e.target.value as (typeof ROLES)[number] });
                    if (!r.ok) setError(r.error);
                  });
                }}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <button
                className="btn btn-sm"
                disabled={pending}
                onClick={() => {
                  const password = window.prompt(`New password for ${u.email} (min 8 chars):`);
                  if (!password) return;
                  setError(null);
                  setNotice(null);
                  startTransition(async () => {
                    const r = await platformResetPassword({ agencyId, agencySlug, userId: u.id, password });
                    if (!r.ok) setError(r.error);
                    else setNotice(`Password reset for ${u.email}.`);
                  });
                }}
              >
                Reset password
              </button>
            </li>
          ))}
          {rows.length === 0 && (
            <li className="muted" style={{ padding: 16 }}>
              No staff accounts yet.
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
