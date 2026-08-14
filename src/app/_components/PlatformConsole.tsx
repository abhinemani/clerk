"use client";

import { useState, useTransition } from "react";
import { branding } from "@/config/branding";
import {
  createAgencyAction,
  linkDirectoryPeerAction,
  platformAddStaff,
  platformResendInvite,
  platformResetPassword,
  platformRevokeSignIn,
  platformSetStaffRole,
  platformSignIn,
  renameAgencyAction,
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
          setDone(
            `${form.name} is live at /${form.slug} — admin signs in at /${form.slug}/app/login. ` +
              `Ingestion API key (copy it NOW, it is not stored): ${r.ingestKey}`,
          );
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

// --- agency identity --------------------------------------------------------

/**
 * Display-name editor. Slug and state are shown but not editable — URLs and
 * statute obligations never drift under a rename (accountService.renameAgency
 * enforces the same rule server-side).
 */
export function RenameAgencyForm({
  agencyId,
  agencySlug,
  currentName,
}: {
  agencyId: string;
  agencySlug: string;
  currentName: string;
}) {
  const [name, setName] = useState(currentName);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = name.trim() !== currentName && name.trim().length > 0;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!dirty) return;
        setError(null);
        setNotice(null);
        startTransition(async () => {
          const r = await renameAgencyAction({ agencyId, agencySlug, name });
          if (!r.ok) setError(r.error);
          else setNotice("Agency renamed — the change is logged in the agency's activity.");
        });
      }}
      className="stack"
      style={{ gap: 8 }}
    >
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label className="lbl" htmlFor="agency-rename" style={{ minWidth: 0 }}>
          Display name
        </label>
        <input
          id="agency-rename"
          className="field"
          style={{ flex: 1, minWidth: 220, maxWidth: 380 }}
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={pending}
        />
        <button className="btn btn-sm btn-primary" type="submit" disabled={pending || !dirty}>
          {pending ? "Saving…" : "Rename"}
        </button>
      </div>
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
              {u.hasPassword ? (
                <>
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
                  <button
                    className="btn btn-sm btn-ghost"
                    disabled={pending}
                    onClick={() => {
                      if (
                        !window.confirm(
                          `Revoke sign-in for ${u.email}? Their password is cleared and any open session ends immediately. The account and its history stay; restore access with a reset or a new invite.`,
                        )
                      )
                        return;
                      setError(null);
                      setNotice(null);
                      startTransition(async () => {
                        const r = await platformRevokeSignIn({ agencyId, agencySlug, userId: u.id });
                        if (!r.ok) setError(r.error);
                        else setNotice(`Sign-in revoked for ${u.email}.`);
                      });
                    }}
                  >
                    Revoke sign-in
                  </button>
                </>
              ) : (
                <button
                  className="btn btn-sm"
                  disabled={pending}
                  onClick={() => {
                    setError(null);
                    setNotice(null);
                    startTransition(async () => {
                      const r = await platformResendInvite({ agencyId, agencySlug, userId: u.id });
                      if (!r.ok) setError(r.error);
                      else setNotice(`Invite re-sent to ${u.email} (delivered via the agency's outbox).`);
                    });
                  }}
                >
                  Re-send invite
                </button>
              )}
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

/**
 * Add a staff member to this tenant from the console — the operator's version
 * of the tenant admin's form. Password blank ⇒ invite link via the outbox.
 */
export function PlatformAddStaffForm({ agencyId, agencySlug }: { agencyId: string; agencySlug: string }) {
  const empty = { email: "", name: "", role: "responder" as (typeof ROLES)[number], password: "" };
  const [form, setForm] = useState(empty);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        setNotice(null);
        startTransition(async () => {
          const r = await platformAddStaff({
            agencyId,
            agencySlug,
            email: form.email,
            name: form.name,
            role: form.role,
            password: form.password || undefined,
          });
          if (!r.ok) {
            setError(r.error);
            return;
          }
          setNotice(
            form.password
              ? `${form.email} can sign in now at /${agencySlug}/app/login.`
              : `Invite sent to ${form.email} via the agency's outbox — the link sets their password.`,
          );
          setForm(empty);
        });
      }}
      className="card card-pad stack"
      style={{ gap: 12 }}
    >
      <div className="panel-title">Add a staff member</div>
      <div className="pc-staff-grid">
        <div className="stack" style={{ gap: 6 }}>
          <label className="lbl" htmlFor="ps-name">
            Name
          </label>
          <input id="ps-name" className="field" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <label className="lbl" htmlFor="ps-email">
            Email
          </label>
          <input id="ps-email" type="email" className="field" required value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <label className="lbl" htmlFor="ps-role">
            Role
          </label>
          <select id="ps-role" className="field" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as (typeof ROLES)[number] }))}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <label className="lbl" htmlFor="ps-pass">
            Password <span className="muted">(blank = email an invite)</span>
          </label>
          <input id="ps-pass" type="text" className="field" minLength={8} value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
        </div>
      </div>
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
      <div>
        <button className="btn btn-sm btn-primary" type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add staff member"}
        </button>
      </div>
      <style>{`
        .pc-staff-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
        @media (max-width: 860px) { .pc-staff-grid { grid-template-columns: 1fr 1fr; } }
        @media (max-width: 560px) { .pc-staff-grid { grid-template-columns: 1fr; } }
      `}</style>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Referral phase 3: directory ↔ tenant links. Platform scope on purpose —
// which agencies share this deployment is the operator's knowledge.
// ---------------------------------------------------------------------------

export interface DirectoryLinkRow {
  id: string;
  name: string;
  jurisdictionType: string;
  peerAgencyId: string | null;
}

export function DirectoryPeerLinks({
  agencyId,
  agencySlug,
  entries,
  agencies,
}: {
  agencyId: string;
  agencySlug: string;
  entries: DirectoryLinkRow[];
  /** Every OTHER tenant on this deployment. */
  agencies: { id: string; name: string; slug: string }[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (entries.length === 0) {
    return (
      <p className="muted" style={{ fontSize: "0.9rem" }}>
        This agency has no referral directory entries yet. Their admin adds them under Manage
        staff → Referral directory; entries can then be linked to tenants here.
      </p>
    );
  }

  return (
    <div className="stack" style={{ gap: 10 }}>
      {error && (
        <p className="pill band-overdue" role="alert" style={{ justifySelf: "start" }}>
          {error}
        </p>
      )}
      <div className="card" style={{ overflow: "hidden" }}>
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {entries.map((e) => (
            <li
              key={e.id}
              style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}
            >
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 600 }}>{e.name}</div>
                <div className="muted" style={{ fontSize: "0.8rem" }}>
                  {e.jurisdictionType.replace(/_/g, " ")}
                  {e.peerAgencyId ? " · forwarding enabled" : ""}
                </div>
              </div>
              <select
                className="field"
                style={{ fontSize: "0.85rem", padding: "7px 10px", maxWidth: 260 }}
                value={e.peerAgencyId ?? ""}
                disabled={pending}
                aria-label={`${branding.productName} tenant for ${e.name}`}
                onChange={(ev) => {
                  const peerAgencyId = ev.target.value || null;
                  setError(null);
                  startTransition(async () => {
                    const res = await linkDirectoryPeerAction({
                      agencyId,
                      agencySlug,
                      entryId: e.id,
                      peerAgencyId,
                    });
                    if (!res.ok) setError(res.error);
                  });
                }}
              >
                <option value="">Not a {branding.productName} tenant</option>
                {agencies.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} (/{a.slug})
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      </div>
      <p className="muted" style={{ fontSize: "0.8rem" }}>
        Linking an entry turns Refer into <strong>Refer &amp; forward</strong> in that agency&apos;s
        workspace: one click re-files the request with the target tenant. Only the request text
        crosses — contact details need per-forward consent from staff.
      </p>
    </div>
  );
}
