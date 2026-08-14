"use client";

/**
 * "Book a walkthrough" — the marketing site's second call to action.
 *
 * A scheduling form without a calendar: records offices don't live in a
 * booking widget, and wiring one would mean a third-party service in the
 * default path (self-contained first). So the visitor tells us their week —
 * which weekdays, which part of the day, which zone — and a person confirms.
 * A deployment with a real booking page sets DEMO_SCHEDULING_URL and the page
 * offers that too (rendered by the page, above this form).
 */
import { useState, useTransition } from "react";
import { DEMO_DAYS, DEMO_TIMEZONES, DEMO_WINDOWS } from "@/domain/demoRequest";
import { requestDemoAction } from "../demo/actions";

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function DemoRequestForm({ states }: { states: { code: string; name: string }[] }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [organization, setOrganization] = useState("");
  const [role, setRole] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [days, setDays] = useState<string[]>([]);
  const [windows, setWindows] = useState<string[]>([]);
  const [timezone, setTimezone] = useState("ET");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  if (sent) {
    return (
      <div className="card card-pad stack" style={{ gap: 12, borderLeft: "3px solid var(--ok)" }}>
        <div className="panel-title">✓ We have your request</div>
        <p style={{ fontSize: "0.95rem" }}>
          A person — not an autoresponder — replies to <span className="mono">{email}</span> with a
          time inside your window, usually within a business day.
        </p>
        <p className="muted" style={{ fontSize: "0.85rem" }}>
          Don&apos;t want to wait? The live demo is open right now, and so is self-signup.
        </p>
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
          const r = await requestDemoAction({
            name,
            email,
            organization,
            role,
            stateCode,
            days,
            windows,
            timezone,
            note,
          });
          if (!r.ok) {
            setError(r.error);
            return;
          }
          setSent(true);
        });
      }}
    >
      <div className="form-grid">
        <div className="stack" style={{ gap: 6 }}>
          <label className="lbl" htmlFor="dm-name">
            Your name
          </label>
          <input id="dm-name" className="field" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <label className="lbl" htmlFor="dm-email">
            Work email
          </label>
          <input
            id="dm-email"
            type="email"
            className="field"
            required
            placeholder="clerk@yourcity.gov"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
      </div>

      <div className="form-grid">
        <div className="stack" style={{ gap: 6 }}>
          <label className="lbl" htmlFor="dm-org">
            Jurisdiction or organization
          </label>
          <input
            id="dm-org"
            className="field"
            required
            placeholder="City of Riverton"
            value={organization}
            onChange={(e) => setOrganization(e.target.value)}
          />
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <label className="lbl" htmlFor="dm-role">
            Your title{" "}
            <span className="muted" style={{ fontWeight: 400 }}>
              (optional)
            </span>
          </label>
          <input
            id="dm-role"
            className="field"
            placeholder="City Clerk"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          />
        </div>
      </div>

      <div className="stack" style={{ gap: 6 }}>
        <label className="lbl" htmlFor="dm-state">
          State{" "}
          <span className="muted" style={{ fontWeight: 400 }}>
            (optional — we&apos;ll demo on your statute)
          </span>
        </label>
        <select id="dm-state" className="field" value={stateCode} onChange={(e) => setStateCode(e.target.value)}>
          <option value="">Not listed / elsewhere</option>
          {states.map((s) => (
            <option key={s.code} value={s.code}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <hr className="divider" />
      <div className="panel-title">When works?</div>

      {/* Checkbox groups, not a calendar: no availability is being claimed
          here, so a grid of bookable slots would be a lie. */}
      <fieldset className="stack" style={{ gap: 8, border: 0, padding: 0, margin: 0 }}>
        <legend className="lbl">Days that usually work</legend>
        <div className="chip-row">
          {DEMO_DAYS.map((d) => (
            <label key={d.value} className={`chip-toggle${days.includes(d.value) ? " is-on" : ""}`}>
              <input
                type="checkbox"
                checked={days.includes(d.value)}
                onChange={() => setDays((cur) => toggle(cur, d.value))}
              />
              {d.label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="stack" style={{ gap: 8, border: 0, padding: 0, margin: 0 }}>
        <legend className="lbl">Time of day</legend>
        <div className="chip-row">
          {DEMO_WINDOWS.map((w) => (
            <label key={w.value} className={`chip-toggle${windows.includes(w.value) ? " is-on" : ""}`}>
              <input
                type="checkbox"
                checked={windows.includes(w.value)}
                onChange={() => setWindows((cur) => toggle(cur, w.value))}
              />
              {w.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="stack" style={{ gap: 6, maxWidth: 280 }}>
        <label className="lbl" htmlFor="dm-tz">
          Your time zone
        </label>
        <select id="dm-tz" className="field" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
          {DEMO_TIMEZONES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div className="stack" style={{ gap: 6 }}>
        <label className="lbl" htmlFor="dm-note">
          Anything you want to see?{" "}
          <span className="muted" style={{ fontWeight: 400 }}>
            (optional)
          </span>
        </label>
        <textarea
          id="dm-note"
          className="field"
          rows={3}
          maxLength={1000}
          placeholder="Our backlog is police records. We're on a 2026 renewal."
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      {error && (
        <p className="pill band-overdue" role="alert" style={{ justifySelf: "start" }}>
          {error}
        </p>
      )}

      <div>
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? "Sending…" : "Send it →"}
        </button>
      </div>
      <p className="muted" style={{ fontSize: "0.78rem" }}>
        Used to schedule your walkthrough. No list, no drip campaign.
      </p>
    </form>
  );
}
