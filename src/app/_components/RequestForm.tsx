"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { dateShort } from "@/lib/format";
import { fileRequest } from "../portal/actions";

type RequesterType = "individual" | "media" | "legal" | "commercial" | "government";

/**
 * Resident request-submission flow. Submitting calls the `fileRequest` server
 * action — the real service layer: the request is persisted, gets a public id
 * and statutory deadline, and lands in the staff queue at /app.
 */
export function RequestForm({ initialQuery = "" }: { initialQuery?: string }) {
  const [text, setText] = useState(initialQuery);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [type, setType] = useState<RequesterType>("individual");
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<null | { publicId: string; dueLabel: string }>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (text.trim().length < 3 || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await fileRequest({ text, name, email, type });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const dueLabel = result.dueAtISO ? dateShort(new Date(result.dueAtISO)) : "the statutory deadline";
      setSubmitted({ publicId: result.publicId, dueLabel });
    });
  }

  if (submitted) {
    return (
      <div className="card" style={{ overflow: "hidden" }}>
        <div style={{ padding: "16px 22px", background: "var(--ok-bg)", borderBottom: "1px solid var(--ok-border)" }}>
          <span className="pill band-on_track">✓ Request filed</span>
        </div>
        <div className="card-pad">
          <div className="muted" style={{ fontSize: "0.82rem" }}>
            Your tracking number
          </div>
          <div className="mono serif" style={{ fontSize: "1.8rem", fontWeight: 600, letterSpacing: "-0.01em" }}>
            {submitted.publicId}
          </div>
          <p style={{ marginTop: 12 }}>
            We&apos;ve received your request and will respond by <strong>{submitted.dueLabel}</strong>.
            {email ? " We&apos;ll email you at each step." : " Save your tracking number to check status."}
          </p>
          <div className="stat-row" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginTop: 18 }}>
            {[
              ["1. Review", "We interpret your request and route it to the right departments."],
              ["2. Gather", "Departments locate responsive records."],
              ["3. Release", "We review, redact if needed, and send your records."],
            ].map(([t, d]) => (
              <div key={t} className="stat" style={{ padding: "14px 16px" }}>
                <div style={{ fontWeight: 600, fontSize: "0.9rem", color: "var(--primary)" }}>{t}</div>
                <div className="muted" style={{ fontSize: "0.82rem", marginTop: 4 }}>
                  {d}
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <Link href={`/portal/track?id=${submitted.publicId}`} className="btn btn-primary">
              Track this request
            </Link>
            <Link href="/" className="btn btn-ghost">
              Back to portal
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="card card-pad stack" style={{ gap: 16 }}>
      <div className="stack" style={{ gap: 6 }}>
        <label className="lbl" htmlFor="what">
          What records are you looking for?
        </label>
        <textarea
          id="what"
          className="field"
          rows={4}
          required
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. All inspection reports for 400 Main St from January 2024 to present."
        />
        <span className="muted" style={{ fontSize: "0.82rem" }}>
          Tip: adding a date range and specific records speeds up your request.
        </span>
      </div>

      <div className="stack" style={{ gap: 6 }}>
        <label className="lbl" htmlFor="type">
          I&apos;m requesting as
        </label>
        <select id="type" className="field" value={type} onChange={(e) => setType(e.target.value as RequesterType)}>
          <option value="individual">A resident</option>
          <option value="media">A journalist</option>
          <option value="legal">An attorney</option>
          <option value="commercial">A business</option>
          <option value="government">Another agency</option>
        </select>
      </div>

      <div className="grid2">
        <div className="stack" style={{ gap: 6 }}>
          <label className="lbl" htmlFor="name">
            Your name <span className="muted" style={{ fontWeight: 400 }}>(optional)</span>
          </label>
          <input id="name" className="field" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <label className="lbl" htmlFor="email">
            Email <span className="muted" style={{ fontWeight: 400 }}>(optional)</span>
          </label>
          <input id="email" type="email" className="field" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="For status updates" />
        </div>
      </div>

      <p className="muted" style={{ fontSize: "0.82rem" }}>
        You can request anonymously — an email just lets us send updates. This is free.
      </p>

      {error && (
        <p className="pill band-overdue" role="alert" style={{ justifySelf: "start" }}>
          {error}
        </p>
      )}

      <div>
        <button className="btn btn-primary" type="submit" disabled={text.trim().length < 3 || pending}>
          {pending ? "Filing…" : "File request"}
        </button>
      </div>

      <style>{`
        .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        @media (max-width: 560px) { .grid2 { grid-template-columns: 1fr; } }
      `}</style>
    </form>
  );
}
