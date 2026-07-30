"use client";

import { useRef, useState, useTransition } from "react";
import { TASK_STATUS_LABEL, type TaskStatus } from "@/domain/taskWorkflow";
import {
  pushBackAction,
  startTaskAction,
  submitRecordFilesAction,
  submitRecordsAction,
} from "../task/[token]/actions";

export interface TaskConsoleProps {
  token: string;
  /** Live tasks persist via server actions; demo-fixture tasks stay local. */
  live: boolean;
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
  /** Real files chosen but not yet submitted (live tasks only). */
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState("");
  const [showPushback, setShowPushback] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function addFile() {
    if (props.live) {
      fileInput.current?.click(); // real files for real tasks
      return;
    }
    setUploads((u) => [...u, { name: `document-${u.length + 1}.pdf`, pages: 2 + u.length + 1 }]);
  }

  function onFilesChosen(list: FileList | null) {
    if (!list) return;
    // Snapshot NOW: clearing input.value empties the live FileList, and the
    // state updater runs after that clear.
    const files = Array.from(list);
    if (!files.length) return;
    setError(null);
    setPendingFiles((prev) => [...prev, ...files]);
    if (fileInput.current) fileInput.current.value = "";
  }

  /** Optimistic move backed by the server action when live. */
  function run(next: TaskStatus, act: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    if (!props.live) {
      setStatus(next);
      return;
    }
    startTransition(async () => {
      const result = await act();
      if (result.ok) setStatus(next);
      else setError(result.error ?? "Something went wrong.");
    });
  }

  const start = () => run("in_progress", () => startTaskAction(props.token));
  const submit = () => {
    if (!props.live) {
      run("submitted", () => submitRecordsAction(props.token, uploads));
      return;
    }
    // Live: ship the actual bytes.
    const formData = new FormData();
    for (const f of pendingFiles) formData.append("files", f);
    run("submitted", async () => {
      const result = await submitRecordFilesAction(props.token, formData);
      if (result.ok) {
        setUploads((u) => [...u, ...pendingFiles.map((f) => ({ name: f.name, pages: 0 }))]);
        setPendingFiles([]);
      }
      return result;
    });
  };
  const sendPushback = () => run("pushed_back", () => pushBackAction(props.token, note));

  const attachedCount = props.live ? pendingFiles.length : uploads.length;

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

        {/* Uploads: already-submitted records + (live) files staged to send */}
        <div style={{ marginTop: 22 }}>
          <div className="panel-title">Records ({uploads.length + pendingFiles.length})</div>
          <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
            {uploads.map((u, i) => (
              <div
                key={`${u.name}-${i}`}
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
                  {u.pages ? `${u.pages} pages` : "uploaded"}
                </span>
              </div>
            ))}
            {pendingFiles.map((f, i) => (
              <div
                key={`pending-${f.name}-${i}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  border: "1px dashed var(--border-strong)",
                  borderRadius: "var(--r-sm)",
                }}
              >
                <span className="mono" style={{ fontSize: "0.85rem" }}>
                  {f.name}
                </span>
                <span className="muted" style={{ marginLeft: "auto", fontSize: "0.82rem" }}>
                  {(f.size / 1024).toFixed(0)} KB · ready to submit
                </span>
                <button
                  className="btn btn-sm btn-ghost"
                  aria-label={`Remove ${f.name}`}
                  onClick={() => setPendingFiles((prev) => prev.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </div>
            ))}
            {uploads.length + pendingFiles.length === 0 && (
              <div className="muted" style={{ fontSize: "0.9rem" }}>
                No files attached yet.
              </div>
            )}
          </div>

          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(e) => onFilesChosen(e.target.files)}
          />
          {!done && (
            <button className="btn btn-sm" style={{ marginTop: 12 }} onClick={addFile}>
              + Add file{props.live ? "s" : " (or forward to this task's email address)"}
            </button>
          )}
        </div>

        <hr className="divider" style={{ margin: "22px 0" }} />

        {error && (
          <p className="pill band-overdue" role="alert" style={{ marginBottom: 12 }}>
            {error}
          </p>
        )}

        {/* Actions by state */}
        {status === "assigned" && (
          <button className="btn btn-primary" disabled={pending} onClick={start}>
            {pending ? "One moment…" : "Start working on this"}
          </button>
        )}

        {status === "in_progress" && !showPushback && (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              className="btn btn-primary"
              disabled={attachedCount === 0 || pending}
              onClick={submit}
            >
              {pending
                ? "Uploading…"
                : `Submit ${attachedCount} record${attachedCount === 1 ? "" : "s"} to the records office`}
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
                disabled={note.trim().length === 0 || pending}
                onClick={sendPushback}
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
