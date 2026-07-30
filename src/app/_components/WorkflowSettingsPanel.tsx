"use client";

/**
 * Agency workflow-automation policy (src/domain/workflow.ts). Both behaviors
 * are opt-in and internal-only: who owns a request, and which departments are
 * asked. Anything a requester sees still requires a named human.
 */
import { useState, useTransition } from "react";
import { updateWorkflowSettingsAction } from "../[agency]/app/(secure)/admin/actions";

export function WorkflowSettingsPanel({
  agencySlug,
  initial,
}: {
  agencySlug: string;
  initial: { autoAssign: boolean; autoDispatch: boolean; autoDispatchConfidence: number; milestoneEmails: boolean };
}) {
  const [autoAssign, setAutoAssign] = useState(initial.autoAssign);
  const [autoDispatch, setAutoDispatch] = useState(initial.autoDispatch);
  const [threshold, setThreshold] = useState(initial.autoDispatchConfidence);
  const [milestoneEmails, setMilestoneEmails] = useState(initial.milestoneEmails);
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  const dirty =
    autoAssign !== initial.autoAssign ||
    autoDispatch !== initial.autoDispatch ||
    threshold !== initial.autoDispatchConfidence ||
    milestoneEmails !== initial.milestoneEmails;

  return (
    <div className="card card-pad">
      <p className="muted" style={{ fontSize: "0.88rem", margin: 0, maxWidth: 560 }}>
        Off by default. These automate internal routing only — releases, denials, and every
        requester-facing action still require a named member of staff. Every automated move is
        logged like a human one and can be undone from the request page.
      </p>

      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 14, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={autoAssign}
          onChange={(e) => setAutoAssign(e.target.checked)}
          style={{ marginTop: 3 }}
        />
        <span>
          <span style={{ fontWeight: 550 }}>Auto-assign new requests</span>
          <span className="muted" style={{ display: "block", fontSize: "0.85rem" }}>
            Each new request goes to the least-loaded coordinator instead of a shared pile.
          </span>
        </span>
      </label>

      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 12, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={autoDispatch}
          onChange={(e) => setAutoDispatch(e.target.checked)}
          style={{ marginTop: 3 }}
        />
        <span>
          <span style={{ fontWeight: 550 }}>Auto-dispatch high-confidence routing</span>
          <span className="muted" style={{ display: "block", fontSize: "0.85rem" }}>
            When AI routing is at least this confident a department holds the records, the task goes
            out without waiting for a click. Lower-confidence suggestions stay proposal cards.
          </span>
        </span>
      </label>

      {autoDispatch && (
        <div style={{ marginTop: 12, marginLeft: 26, display: "flex", alignItems: "center", gap: 10 }}>
          <input
            type="range"
            min={0.5}
            max={1}
            step={0.05}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            style={{ width: 180 }}
            aria-label="Auto-dispatch confidence threshold"
          />
          <span className="mono" style={{ fontSize: "0.9rem" }}>
            ≥ {Math.round(threshold * 100)}%
          </span>
        </div>
      )}

      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 12, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={milestoneEmails}
          onChange={(e) => setMilestoneEmails(e.target.checked)}
          style={{ marginTop: 3 }}
        />
        <span>
          <span style={{ fontWeight: 550 }}>Email requesters at milestones</span>
          <span className="muted" style={{ display: "block", fontSize: "0.85rem" }}>
            Template-only confirmations when a request is received and when work starts — no AI, no
            surprises, and every send lands in the outbox. On by default; outcome letters and
            extension notices are separate and always sent by staff.
          </span>
        </span>
      </label>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 16 }}>
        <button
          className="btn btn-sm btn-primary"
          disabled={!dirty || pending}
          onClick={() => {
            setNote(null);
            startTransition(async () => {
              const res = await updateWorkflowSettingsAction({
                agencySlug,
                autoAssign,
                autoDispatch,
                autoDispatchConfidence: threshold,
                milestoneEmails,
              });
              setNote(res.ok ? "Saved." : res.error);
            });
          }}
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {note && (
          <span className="muted" style={{ fontSize: "0.85rem" }}>
            {note}
          </span>
        )}
      </div>
    </div>
  );
}
