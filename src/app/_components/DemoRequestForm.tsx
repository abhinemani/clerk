"use client";

/**
 * The walkthrough form. Three required fields and everything else optional —
 * an evaluating clerk is doing US the favor, so the form asks the minimum a
 * human needs to call them back and gets out of the way.
 *
 * The honeypot is a real input positioned off-screen (not display:none —
 * some bots skip hidden fields); it carries aria-hidden + tabIndex -1 so no
 * assistive tech or keyboard user ever lands on it.
 */
import { useState, useTransition } from "react";
import { requestWalkthroughAction } from "../demo/actions";

export function DemoRequestForm({
  states,
  source,
}: {
  states: { code: string; name: string }[];
  /** Which CTA sent them, for the operator console. */
  source?: string;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [organization, setOrganization] = useState("");
  const [role, setRole] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [notes, setNotes] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  if (sent) {
    return (
      <div className="card card-pad stack" style={{ gap: 12, borderLeft: "3px solid var(--ok)" }}>
        <div className="panel-title">✓ Request received</div>
        <p style={{ fontSize: "0.95rem" }}>
          We&apos;ll email <span className="mono">{email}</span> within one business day with a
          couple of times. If it&apos;s easier, reply with your own.
        </p>
        <p className="muted" style={{ fontSize: "0.85rem" }}>
          In the meantime the live demo is open — no login, nothing to install.
        </p>
      </div>
    );
  }

  return (
    <form
      className="card card-pad stack"
      style={{ gap: 18 }}
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const r = await requestWalkthroughAction({
            name,
            email,
            organization,
            role,
            stateCode,
            notes,
            source,
            honeypot,
          });
          if (r.ok) setSent(true);
          else setError(r.error);
        });
      }}
    >
      <div className="stack" style={{ gap: 6 }}>
        <label className="lbl" htmlFor="dr-name">
          Your name
        </label>
        <input
          id="dr-name"
          className="field"
          required
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="stack" style={{ gap: 6 }}>
        <label className="lbl" htmlFor="dr-email">
          Work email
        </label>
        <input
          id="dr-email"
          className="field"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <div className="stack" style={{ gap: 6 }}>
        <label className="lbl" htmlFor="dr-org">
          Agency or organization
        </label>
        <input
          id="dr-org"
          className="field"
          required
          placeholder="City of Riverton"
          autoComplete="organization"
          value={organization}
          onChange={(e) => setOrganization(e.target.value)}
        />
      </div>

      <div className="roster-grid">
        <div className="stack" style={{ gap: 6 }}>
          <label className="lbl" htmlFor="dr-role">
            Your role{" "}
            <span className="muted" style={{ fontWeight: 400 }}>
              (optional)
            </span>
          </label>
          <input
            id="dr-role"
            className="field"
            placeholder="City Clerk"
            autoComplete="organization-title"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          />
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <label className="lbl" htmlFor="dr-state">
            State{" "}
            <span className="muted" style={{ fontWeight: 400 }}>
              (optional)
            </span>
          </label>
          <select
            id="dr-state"
            className="field"
            value={stateCode}
            onChange={(e) => setStateCode(e.target.value)}
          >
            <option value="">Not listed</option>
            {states.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="stack" style={{ gap: 6 }}>
        <label className="lbl" htmlFor="dr-notes">
          What would you like to see?{" "}
          <span className="muted" style={{ fontWeight: 400 }}>
            (optional)
          </span>
        </label>
        <textarea
          id="dr-notes"
          className="field"
          rows={4}
          placeholder="Times that work for you, the part of the process that hurts most, questions from counsel…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {/* Honeypot — off-screen, never announced, never focusable. */}
      <input
        type="text"
        name="company_website"
        value={honeypot}
        onChange={(e) => setHoneypot(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }}
      />

      {error && (
        <p className="pill band-overdue" role="alert" style={{ justifySelf: "start" }}>
          {error}
        </p>
      )}

      <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? "Sending…" : "Send request"}
        </button>
        <span className="muted" style={{ fontSize: "0.82rem" }}>
          30 minutes. No slide deck.
        </span>
      </div>
    </form>
  );
}
