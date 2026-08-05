"use client";

/**
 * Statute sign-off + transparency log controls. The sign-off form is an
 * attestation, not a checkbox — it wants a name and a date.
 */
import { useState, useTransition } from "react";
import {
  recordStatuteReviewAction,
  setTransparencyLogAction,
} from "../[agency]/app/(secure)/admin/actions";

export interface StatuteVM {
  stateName: string;
  initialDays: number;
  dayType: string;
  extensionMaxDays: number | null;
  exemptionCount: number;
  review: { reviewedBy: string; reviewedOn: string; note?: string } | null;
}

export function CompliancePanel({
  agencySlug,
  statute,
  logEnabled,
}: {
  agencySlug: string;
  statute: StatuteVM | null;
  logEnabled: boolean;
}) {
  const [reviewedBy, setReviewedBy] = useState("");
  const [reviewedOn, setReviewedOn] = useState("");
  const [note, setNote] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="stack" style={{ gap: 12 }}>
      {/* Statute profile + counsel sign-off */}
      <div className="card card-pad">
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div className="panel-title">Statute profile</div>
          {statute?.review ? (
            <span className="pill band-on_track" style={{ marginLeft: "auto" }}>
              ✓ Reviewed by counsel
            </span>
          ) : (
            <span className="pill band-due_soon" style={{ marginLeft: "auto" }}>
              Not yet reviewed by your counsel
            </span>
          )}
        </div>

        {statute ? (
          <>
            <p style={{ fontSize: "0.92rem", margin: "8px 0 0" }}>
              {statute.stateName}: respond within <strong>{statute.initialDays} {statute.dayType} days</strong>
              {statute.extensionMaxDays ? `, one extension up to ${statute.extensionMaxDays} days` : ", no extension"} ·{" "}
              {statute.exemptionCount} exemption{statute.exemptionCount === 1 ? "" : "s"} in the catalog.
            </p>
            {statute.review ? (
              <p className="muted" style={{ fontSize: "0.85rem", marginTop: 8 }}>
                Signed off by <strong>{statute.review.reviewedBy}</strong> on {statute.review.reviewedOn}
                {statute.review.note ? ` — “${statute.review.note}”` : ""}. Statutes change: re-record
                after each legislative session.
              </p>
            ) : (
              <p className="muted" style={{ fontSize: "0.85rem", marginTop: 8 }}>
                Deadlines and exemption labels come from the shipped {statute.stateName} profile.
                Have your counsel confirm it matches current law, then record it here — the date
                shows in your audit trail.
              </p>
            )}

            {!statute.review && !showForm && (
              <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => setShowForm(true)}>
                Record counsel sign-off…
              </button>
            )}
            {(showForm || statute.review) && !statute.review && (
              <div className="stack" style={{ gap: 8, marginTop: 10 }}>
                <div className="roster-grid">
                  <label style={{ display: "grid", gap: 4 }}>
                    <span className="lbl">Reviewed by</span>
                    <input
                      className="field"
                      placeholder="M. Chen, City Attorney"
                      value={reviewedBy}
                      onChange={(e) => setReviewedBy(e.target.value)}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 4 }}>
                    <span className="lbl">On</span>
                    <input
                      type="date"
                      className="field"
                      value={reviewedOn}
                      onChange={(e) => setReviewedOn(e.target.value)}
                    />
                  </label>
                </div>
                <label style={{ display: "grid", gap: 4 }}>
                  <span className="lbl">Note (optional)</span>
                  <input
                    className="field"
                    placeholder="Confirmed against 2026 amendments."
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
                {error && (
                  <p className="pill band-overdue" role="alert" style={{ justifySelf: "start" }}>
                    {error}
                  </p>
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    className="btn btn-sm btn-primary"
                    disabled={pending || !reviewedBy.trim() || !reviewedOn}
                    onClick={() => {
                      setError(null);
                      startTransition(async () => {
                        const r = await recordStatuteReviewAction({ agencySlug, reviewedBy, reviewedOn, note });
                        if (!r.ok) setError(r.error);
                      });
                    }}
                  >
                    {pending ? "Recording…" : "Record sign-off"}
                  </button>
                  <button className="btn btn-sm btn-ghost" disabled={pending} onClick={() => setShowForm(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="pill band-overdue" style={{ marginTop: 8 }}>
            No statute profile exists for your state — deadlines cannot be computed. Contact the
            deployment operator.
          </p>
        )}
      </div>

      {/* Transparency log */}
      <div className="card card-pad">
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div className="panel-title">Public request log</div>
            <p className="muted" style={{ fontSize: "0.85rem", margin: "6px 0 0", maxWidth: 520 }}>
              Publishes every request&apos;s number, subject, dates, and outcome at{" "}
              <span className="mono">/{agencySlug}/log</span> — with on-time statistics. Requester
              identities never appear, and subjects show only staff-curated wording (never the raw
              filing text).
            </p>
          </div>
          <label style={{ display: "inline-flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={logEnabled}
              disabled={pending}
              onChange={(e) => {
                setError(null);
                const enabled = e.target.checked;
                startTransition(async () => {
                  const r = await setTransparencyLogAction({ agencySlug, enabled });
                  if (!r.ok) setError(r.error);
                });
              }}
            />
            <span style={{ fontSize: "0.9rem", fontWeight: 600 }}>{logEnabled ? "Published" : "Off"}</span>
          </label>
        </div>
        {logEnabled && (
          <a className="btn btn-sm" style={{ marginTop: 10 }} href={`/${agencySlug}/log`}>
            View the public log →
          </a>
        )}
      </div>
    </div>
  );
}
