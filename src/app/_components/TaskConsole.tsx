"use client";

import { useState } from "react";
import { TASK_STATUS_LABEL, type TaskStatus } from "@/domain/taskWorkflow";

export interface TaskConsoleProps {
  requestPublicId: string;
  agencyName: string;
  deptName: string;
  deptLead: string;
  scope: string;
  dueLabel: string;
  initialStatus: TaskStatus;
  initialUploads: { name: string; pages: number }[];
}

export function TaskConsole(props: TaskConsoleProps) {
  const [status, setStatus] = useState<TaskStatus>(props.initialStatus);
  const [uploads, setUploads] = useState(props.initialUploads);
  const [note, setNote] = useState("");
  const [showPushback, setShowPushback] = useState(false);

  function addFile() {
    const n = uploads.length + 1;
    setUploads((u) => [...u, { name: `document-${n}.pdf`, pages: 2 + n }]);
  }

  const done = status === "done" || status === "submitted" || status === "pushed_back";

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      {/* Status banner */}
      <div
        style={{
          padding: "14px 20px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          background:
            status === "pushed_back"
              ? "var(--overdue-bg)"
              : status === "submitted" || status === "done"
                ? "var(--ok-bg)"
                : "var(--surface-2)",
        }}
      >
        <span
          className={`pill ${
            status === "pushed_back"
              ? "band-overdue"
              : status === "submitted" || status === "done"
                ? "band-on_track"
                : "band-due_soon"
          }`}
        >
          {TASK_STATUS_LABEL[status]}
        </span>
        <span className="muted" style={{ fontSize: "0.85rem", marginLeft: "auto" }}>
          {props.dueLabel}
        </span>
      </div>

      <div className="card-pad">
        <div className="panel-title">What we need</div>
        <p style={{ fontSize: "1.02rem", marginTop: 8 }}>{props.scope}</p>

        {/* Uploads */}
        <div style={{ marginTop: 22 }}>
          <div className="panel-title">Records ({uploads.length})</div>
          <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
            {uploads.map((u) => (
              <div
                key={u.name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--r-sm)",
                  background: "var(--surface-2)",
                }}
              >
                <span className="mono" style={{ fontSize: "0.85rem" }}>
                  {u.name}
                </span>
                <span className="muted" style={{ marginLeft: "auto", fontSize: "0.82rem" }}>
                  {u.pages} pages
                </span>
              </div>
            ))}
            {uploads.length === 0 && (
              <div className="muted" style={{ fontSize: "0.9rem" }}>
                No files attached yet.
              </div>
            )}
          </div>

          {!done && (
            <button className="btn btn-sm" style={{ marginTop: 12 }} onClick={addFile}>
              + Add file (or forward to this task&apos;s email address)
            </button>
          )}
        </div>

        <hr className="divider" style={{ margin: "22px 0" }} />

        {/* Actions by state */}
        {status === "assigned" && (
          <button className="btn btn-primary" onClick={() => setStatus("in_progress")}>
            Start working on this
          </button>
        )}

        {status === "in_progress" && !showPushback && (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              className="btn btn-primary"
              disabled={uploads.length === 0}
              onClick={() => setStatus("submitted")}
            >
              Submit {uploads.length} record{uploads.length === 1 ? "" : "s"} to the records office
            </button>
            <button className="btn" onClick={() => setShowPushback(true)}>
              Can&apos;t fulfill / push back
            </button>
          </div>
        )}

        {status === "in_progress" && showPushback && (
          <div className="stack" style={{ gap: 10 }}>
            <label className="lbl" htmlFor="pb">
              Tell the coordinator what&apos;s blocking this
            </label>
            <textarea
              id="pb"
              className="field"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. one record is part of an open investigation — recommend legal review."
            />
            <div style={{ display: "flex", gap: 10 }}>
              <button
                className="btn btn-danger"
                disabled={note.trim().length === 0}
                onClick={() => setStatus("pushed_back")}
              >
                Send pushback
              </button>
              <button className="btn btn-ghost" onClick={() => setShowPushback(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {status === "submitted" && (
          <div className="pill band-on_track" style={{ fontSize: "0.9rem", padding: "8px 14px" }}>
            ✓ Submitted to {props.agencyName} records office — thank you. You can close this page.
          </div>
        )}

        {status === "pushed_back" && (
          <div className="pill band-overdue" style={{ fontSize: "0.9rem", padding: "8px 14px" }}>
            Sent back to the coordinator with your note. They&apos;ll follow up.
          </div>
        )}
      </div>
    </div>
  );
}
