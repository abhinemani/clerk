"use client";

/**
 * Jurisdiction signup form. Success shows the ingest key EXACTLY ONCE (hash
 * at rest, like the platform-console flow) before entering the workspace —
 * where the go-live checklist takes over.
 */
import { useState, useTransition } from "react";
import { selfSignupAction, signupSignInAction } from "../signup/actions";

function suggestSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/city of |county of |town of |village of /g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

export function SignupForm({ states }: { states: { code: string; name: string }[] }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [stateCode, setStateCode] = useState(states[0]?.code ?? "");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [created, setCreated] = useState<{ slug: string; ingestKey: string } | null>(null);

  if (created) {
    return (
      <div className="card card-pad stack" style={{ gap: 14, borderLeft: "3px solid var(--ok)" }}>
        <div className="panel-title">✓ {name || "Your jurisdiction"} is live</div>
        <p style={{ fontSize: "0.95rem" }}>
          Resident portal: <span className="mono">/{created.slug}</span> · Staff workspace:{" "}
          <span className="mono">/{created.slug}/app</span>
        </p>
        <div>
          <div className="lbl">Ingestion API key — shown only once, store it now</div>
          <code
            className="mono"
            style={{ display: "block", padding: "10px 12px", background: "var(--surface-2)", borderRadius: 8, marginTop: 6, fontSize: "0.85rem", wordBreak: "break-all", userSelect: "all" }}
          >
            {created.ingestKey}
          </code>
          <p className="muted" style={{ fontSize: "0.8rem", marginTop: 6 }}>
            Lets your systems push records into the archive later (Settings can&apos;t re-show it).
          </p>
        </div>
        {error && (
          <p className="pill band-overdue" role="alert" style={{ justifySelf: "start" }}>
            {error}
          </p>
        )}
        <div>
          <button
            className="btn btn-primary"
            disabled={pending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const r = await signupSignInAction({
                  slug: created.slug,
                  email: adminEmail,
                  password: adminPassword,
                });
                if (!r.ok) setError(r.error); // success redirects instead
              });
            }}
          >
            {pending ? "Opening…" : "Enter your workspace →"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="card card-pad stack"
      style={{ gap: 14 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (pending) return;
        setError(null);
        startTransition(async () => {
          const r = await selfSignupAction({
            name,
            slug,
            stateCode,
            adminName,
            adminEmail,
            adminPassword,
          });
          if (!r.ok) {
            setError(r.error);
            return;
          }
          setCreated({ slug: r.slug, ingestKey: r.ingestKey });
        });
      }}
    >
      <div className="stack" style={{ gap: 6 }}>
        <label className="lbl" htmlFor="su-name">
          Jurisdiction name
        </label>
        <input
          id="su-name"
          className="field"
          required
          placeholder="City of Riverton"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!slugTouched) setSlug(suggestSlug(e.target.value));
          }}
        />
      </div>

      <div className="roster-grid">
        <div className="stack" style={{ gap: 6 }}>
          <label className="lbl" htmlFor="su-slug">
            Web address
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span className="muted mono" style={{ fontSize: "0.9rem" }}>
              /
            </span>
            <input
              id="su-slug"
              className="field mono"
              required
              pattern="[a-z][a-z0-9-]{1,30}"
              title="Lowercase letters, digits, and dashes"
              placeholder="riverton"
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value.toLowerCase());
              }}
            />
          </div>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <label className="lbl" htmlFor="su-state">
            State{" "}
            <span className="muted" style={{ fontWeight: 400 }}>
              (sets your statutory clock)
            </span>
          </label>
          <select id="su-state" className="field" value={stateCode} onChange={(e) => setStateCode(e.target.value)}>
            {states.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <hr className="divider" />
      <div className="panel-title">Your administrator account</div>

      <div className="roster-grid">
        <div className="stack" style={{ gap: 6 }}>
          <label className="lbl" htmlFor="su-admin-name">
            Your name
          </label>
          <input id="su-admin-name" className="field" required value={adminName} onChange={(e) => setAdminName(e.target.value)} />
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <label className="lbl" htmlFor="su-admin-email">
            Work email
          </label>
          <input
            id="su-admin-email"
            type="email"
            className="field"
            required
            placeholder="clerk@yourcity.gov"
            value={adminEmail}
            onChange={(e) => setAdminEmail(e.target.value)}
          />
        </div>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <label className="lbl" htmlFor="su-admin-pass">
          Password{" "}
          <span className="muted" style={{ fontWeight: 400 }}>
            (8+ characters)
          </span>
        </label>
        <input
          id="su-admin-pass"
          type="password"
          className="field"
          required
          minLength={8}
          value={adminPassword}
          onChange={(e) => setAdminPassword(e.target.value)}
        />
      </div>

      {error && (
        <p className="pill band-overdue" role="alert" style={{ justifySelf: "start" }}>
          {error}
        </p>
      )}

      <div>
        <button className="btn btn-primary" type="submit" disabled={pending} style={{ paddingInline: 22 }}>
          {pending ? "Creating your workspace…" : "Create your records office"}
        </button>
      </div>
    </form>
  );
}
