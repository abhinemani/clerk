"use client";

import { useState } from "react";
import Link from "next/link";
import { computeDueDate } from "@/statute/computeDueDate";
import { getStateProfile } from "@/statute/profiles";
import { formatPublicId } from "@/domain/publicId";
import { dateShort } from "@/lib/format";

type RequesterType = "individual" | "media" | "legal" | "commercial" | "government";

/**
 * Resident request-submission flow. On submit it mirrors what the service layer
 * does (mint a public id, compute the statutory deadline) and shows a
 * confirmation — a working demo of filing, no account required.
 */
export function RequestForm({ initialQuery = "" }: { initialQuery?: string }) {
  const [text, setText] = useState(initialQuery);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [type, setType] = useState<RequesterType>("individual");
  const [submitted, setSubmitted] = useState<null | { publicId: string; dueLabel: string }>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (text.trim().length < 3) return;

    // Mirror submitRequest: public id + statutory deadline (CA profile).
    const seq = 355 + Math.floor(Math.random() * 90);
    const publicId = formatPublicId(2026, seq);
    const profile = getStateProfile("CA");
    let dueLabel = "within the statutory deadline";
    if (profile) {
      const due = computeDueDate({ receivedAt: new Date(), clock: profile.responseClock, holidays: [] });
      dueLabel = dateShort(due.dueAt);
    }
    setSubmitted({ publicId, dueLabel });
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

      <div>
        <button className="btn btn-primary" type="submit" disabled={text.trim().length < 3}>
          File request
        </button>
      </div>

      <style>{`
        .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        @media (max-width: 560px) { .grid2 { grid-template-columns: 1fr; } }
      `}</style>
    </form>
  );
}
