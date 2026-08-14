"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  canTransitionTask,
  taskOwner,
  TASK_STATUS_LABEL,
  type TaskStatus,
} from "@/domain/taskWorkflow";
import {
  acceptRecordsAction,
  acceptTriageAction,
  dismissTriageAction,
  dispatchTaskAction,
  reassignTaskAction,
  sendBackAction,
} from "../[agency]/app/(secure)/requests/[id]/actions";
import { PREFILL_DISPATCH_EVENT, type PrefillDispatchDetail } from "./prefillEvents";
import { AiPill, Avatar, SparkIcon } from "./ui";

export interface TaskVM {
  id: string;
  token: string;
  deptName: string;
  deptLead: string;
  deptEmail: string;
  scope: string;
  status: TaskStatus;
  dueLabel: string;
  uploads: { name: string; pages: number }[];
  pushbackNote?: string;
}

export interface SuggestionVM {
  id: string;
  deptName: string;
  scope: string;
  rationale: string;
}

export interface TriageVM {
  interpretedScope: string;
  recordTypes: string[];
  redFlags: string[];
  complexityPct: number;
  ambiguity?: string;
}

const STATUS_TONE: Record<TaskStatus, string> = {
  assigned: "band-due_soon",
  in_progress: "band-due_soon",
  submitted: "pill-ai",
  pushed_back: "band-overdue",
  done: "band-on_track",
  cancelled: "",
};

export function RequestWorkspace(props: {
  requestId: string;
  /** Live requests persist via server actions; the demo fixture stays local. */
  live: boolean;
  /** Closed requests are read-only history — no AI proposals to dispose of. */
  closed?: boolean;
  triage: TriageVM;
  initialTasks: TaskVM[];
  initialSuggestions: SuggestionVM[];
  /** Full roster for the manual dispatch form (suggestions carry only their own). */
  departments: { id: string; name: string }[];
  agencySlug: string;
}) {
  const router = useRouter();
  const [tasks, setTasks] = useState<TaskVM[]>(props.initialTasks);
  const [suggestions, setSuggestions] = useState<SuggestionVM[]>(props.initialSuggestions);
  const [triageState, setTriageState] = useState<"proposed" | "accepted" | "dismissed">("proposed");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const base = { agencySlug: props.agencySlug, requestId: props.requestId };

  /** Optimistic update backed by a server action when live; refresh after. */
  function persist(optimistic: () => void, act: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    if (!props.live) {
      optimistic();
      return;
    }
    startTransition(async () => {
      const result = await act();
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      optimistic();
      router.refresh(); // pull the authoritative state + audit timeline
    });
  }

  function move(id: string, to: TaskStatus) {
    const apply = () =>
      setTasks((prev) =>
        prev.map((t) => (t.id === id && canTransitionTask(t.status, to) ? { ...t, status: to } : t)),
      );
    if (to === "done") persist(apply, () => acceptRecordsAction({ ...base, taskId: id }));
    else if (to === "in_progress") persist(apply, () => sendBackAction({ ...base, taskId: id }));
    else if (to === "assigned") persist(apply, () => reassignTaskAction({ ...base, taskId: id }));
    else apply();
  }

  function acceptTriage() {
    persist(
      () => setTriageState("accepted"),
      () =>
        acceptTriageAction({
          ...base,
          interpretedScope: props.triage.interpretedScope,
          recordTypes: props.triage.recordTypes,
        }),
    );
  }

  function dismissTriage() {
    persist(
      () => setTriageState("dismissed"),
      () => dismissTriageAction(base),
    );
  }

  function dispatch(s: SuggestionVM) {
    persist(
      () => {
        setTasks((prev) => [
          ...prev,
          {
            id: `new-${s.id}`,
            token: "",
            deptName: s.deptName,
            deptLead: s.deptName,
            deptEmail: "",
            scope: s.scope,
            status: "assigned",
            dueLabel: "internal due in 3 days",
            uploads: [],
          },
        ]);
        setSuggestions((prev) => prev.filter((x) => x.id !== s.id));
      },
      () => dispatchTaskAction({ ...base, departmentId: s.id, scopeText: s.scope }),
    );
  }

  /* Manual dispatch — for the task the AI didn't suggest, and the landing
     panel for the copilot's propose_task prefill. Same server action, same
     audit trail; only the origin of the text differs. */
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [dispatchDeptId, setDispatchDeptId] = useState(props.departments[0]?.id ?? "");
  const [dispatchScope, setDispatchScope] = useState("");
  const dispatchFormRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (props.closed) return;
    const onPrefill = (e: Event) => {
      const { scope } = (e as CustomEvent<PrefillDispatchDetail>).detail;
      setDispatchOpen(true);
      setDispatchScope(scope);
      // Best-guess the department from the proposal text; the human confirms.
      const named = props.departments.find((d) => scope.toLowerCase().includes(d.name.toLowerCase()));
      if (named) setDispatchDeptId(named.id);
      // After the form renders open, bring it into view.
      requestAnimationFrame(() =>
        dispatchFormRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }),
      );
    };
    window.addEventListener(PREFILL_DISPATCH_EVENT, onPrefill);
    return () => window.removeEventListener(PREFILL_DISPATCH_EVENT, onPrefill);
  }, [props.closed, props.departments]);

  function dispatchManual() {
    const dept = props.departments.find((d) => d.id === dispatchDeptId);
    const scope = dispatchScope.trim();
    if (!dept || !scope) return;
    persist(
      () => {
        setTasks((prev) => [
          ...prev,
          {
            id: `manual-${dept.id}-${prev.length}`,
            token: "",
            deptName: dept.name,
            deptLead: dept.name,
            deptEmail: "",
            scope,
            status: "assigned",
            dueLabel: "internal due in 3 days",
            uploads: [],
          },
        ]);
        setDispatchOpen(false);
        setDispatchScope("");
      },
      () => dispatchTaskAction({ ...base, departmentId: dept.id, scopeText: scope }),
    );
  }

  return (
    <div className="ws-grid">
      {/* Center — the working area: department tasks */}
      <div className="stack" style={{ gap: 18 }}>
        <div id="dept-tasks" style={{ scrollMarginTop: 56 }}>
          <h2 style={{ fontSize: "1.15rem" }}>Department tasks</h2>
          <p className="muted" style={{ fontSize: "0.9rem", marginTop: 2 }}>
            Each task is a scoped ask to the department that holds the records. You dispatch; they
            fulfill from a no-login link and send it back.
          </p>
        </div>

        {error && (
          <p className="pill band-overdue" role="alert">
            {error}
          </p>
        )}

        {tasks.map((t) => (
          <TaskCard key={t.id} task={t} onMove={move} agencySlug={props.agencySlug} />
        ))}

        {tasks.length === 0 && (
          <div className="card card-pad muted" style={{ fontSize: "0.92rem" }}>
            No tasks dispatched yet. Accept a routing suggestion — or dispatch one yourself below.
          </div>
        )}

        {/* Manual dispatch form (also the copilot prefill target). */}
        {!props.closed && props.departments.length > 0 && (
          <div ref={dispatchFormRef}>
            {!dispatchOpen ? (
              <button className="btn btn-sm" onClick={() => setDispatchOpen(true)}>
                Dispatch a task…
              </button>
            ) : (
              <div className="card card-pad stack" style={{ gap: 8 }}>
                <div className="panel-title">Dispatch a task</div>
                <label className="lbl" htmlFor="dispatch-dept">
                  Department
                </label>
                <select
                  id="dispatch-dept"
                  className="field"
                  value={dispatchDeptId}
                  onChange={(e) => setDispatchDeptId(e.target.value)}
                >
                  {props.departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <label className="lbl" htmlFor="dispatch-scope">
                  What should they pull?
                </label>
                <textarea
                  id="dispatch-scope"
                  className="field"
                  rows={3}
                  value={dispatchScope}
                  onChange={(e) => setDispatchScope(e.target.value)}
                  placeholder="Scope the ask — records, date range, custodian…"
                />
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    className="btn btn-sm btn-primary"
                    disabled={pending || !dispatchScope.trim()}
                    onClick={dispatchManual}
                  >
                    Dispatch
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={() => setDispatchOpen(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right — the AI panel: triage + routing suggestions. Closed requests
          get no proposals: there is nothing left to dispose of. */}
      {props.closed ? (
        <aside className="stack" style={{ gap: 16 }}>
          <div className="panel-title">AI panel</div>
          <div className="card card-pad muted" style={{ fontSize: "0.88rem" }}>
            Request closed — see the release below and the audit log for the full history.
          </div>
        </aside>
      ) : (
      <aside className="stack" style={{ gap: 16 }}>
        <div className="panel-title">AI panel</div>

        {triageState !== "dismissed" && (
          <div className="ai-card">
            <div className="ai-head">
              <AiPill>Intake triage</AiPill>
              <span className="muted" style={{ fontSize: "0.78rem", marginLeft: "auto" }}>
                complexity {props.triage.complexityPct}%
              </span>
            </div>
            <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>{props.triage.interpretedScope}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
              {props.triage.recordTypes.map((rt) => (
                <span key={rt} className="tag">
                  {rt}
                </span>
              ))}
            </div>
            {props.triage.redFlags.map((f) => (
              <div
                key={f}
                className="pill band-overdue"
                style={{ marginTop: 10, display: "inline-flex" }}
              >
                ⚠ {f.replace(/_/g, " ")}
              </div>
            ))}
            {triageState === "accepted" ? (
              <div className="pill band-on_track" style={{ marginTop: 14 }}>
                ✓ Accepted by you
              </div>
            ) : (
              <div className="ai-actions">
                <button className="btn btn-sm btn-primary" disabled={pending} onClick={acceptTriage}>
                  Accept
                </button>
                <button className="btn btn-sm">Edit</button>
                <button className="btn btn-sm btn-ghost" disabled={pending} onClick={dismissTriage}>
                  Dismiss
                </button>
              </div>
            )}
          </div>
        )}

        {suggestions.length > 0 && (
          <div className="stack" style={{ gap: 12 }}>
            <div className="panel-title">Routing suggestions</div>
            {suggestions.map((s) => (
              <div key={s.id} className="ai-card">
                <div className="ai-head">
                  <AiPill>Route</AiPill>
                  <strong style={{ fontSize: "0.9rem" }}>{s.deptName}</strong>
                </div>
                <div style={{ fontSize: "0.9rem" }}>{s.scope}</div>
                <div className="muted" style={{ fontSize: "0.82rem", marginTop: 6 }}>
                  {s.rationale}
                </div>
                <div className="ai-actions">
                  <button className="btn btn-sm btn-primary" disabled={pending} onClick={() => dispatch(s)}>
                    Dispatch to {s.deptName}
                  </button>
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={() => setSuggestions((p) => p.filter((x) => x.id !== s.id))}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </aside>
      )}

      <style>{`
        .ws-grid { display: grid; grid-template-columns: 1fr 340px; gap: 24px; }
        @media (max-width: 980px) { .ws-grid { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  );
}

function TaskCard({
  task,
  onMove,
  agencySlug,
}: {
  task: TaskVM;
  onMove: (id: string, to: TaskStatus) => void;
  agencySlug: string;
}) {
  const owner = taskOwner(task.status);
  const attention = task.status === "pushed_back";
  void agencySlug;

  return (
    <div className={`task-card${attention ? " attention" : ""}`}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Avatar name={task.deptLead} tone="primary" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{task.deptName}</div>
          <div className="muted" style={{ fontSize: "0.82rem" }}>
            {task.deptLead} · {task.dueLabel}
          </div>
        </div>
        <span className={`pill ${STATUS_TONE[task.status]}`}>{TASK_STATUS_LABEL[task.status]}</span>
      </div>

      <p style={{ fontSize: "0.92rem", marginTop: 12 }}>{task.scope}</p>

      {task.uploads.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0", display: "grid", gap: 6 }}>
          {task.uploads.map((u) => (
            <li
              key={u.name}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: "0.85rem",
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
                borderRadius: "var(--r-sm)",
                padding: "7px 10px",
              }}
            >
              <DocIcon />
              <span className="mono">{u.name}</span>
              <span className="muted" style={{ marginLeft: "auto" }}>
                {u.pages}p
              </span>
            </li>
          ))}
        </ul>
      )}

      {task.pushbackNote && (
        <div
          style={{
            marginTop: 12,
            fontSize: "0.88rem",
            color: "var(--overdue)",
            background: "var(--surface)",
            border: "1px solid var(--overdue-border)",
            borderRadius: "var(--r-sm)",
            padding: "10px 12px",
          }}
        >
          <strong>Pushback from {task.deptLead}:</strong> {task.pushbackNote}
        </div>
      )}

      {/* Owner-appropriate actions — the workflow's hand-offs */}
      <div style={{ display: "flex", gap: 8, marginTop: 14, alignItems: "center", flexWrap: "wrap" }}>
        {owner === "responder" && (
          <>
            <span className="muted" style={{ fontSize: "0.82rem" }}>
              Awaiting {task.deptLead}
            </span>
            <Link href={`/task/${task.token}`} className="btn btn-sm" style={{ marginLeft: "auto" }}>
              Open responder view →
            </Link>
          </>
        )}
        {task.status === "submitted" && (
          <>
            <button className="btn btn-sm btn-primary" onClick={() => onMove(task.id, "done")}>
              Accept records
            </button>
            <button className="btn btn-sm" onClick={() => onMove(task.id, "in_progress")}>
              Send back
            </button>
          </>
        )}
        {task.status === "pushed_back" && (
          <>
            <button className="btn btn-sm btn-primary" onClick={() => onMove(task.id, "assigned")}>
              Re-scope &amp; reassign
            </button>
            <button className="btn btn-sm">Escalate to City Attorney</button>
          </>
        )}
        {task.status === "done" && (
          <span className="pill band-on_track">✓ Records received</span>
        )}
      </div>
    </div>
  );
}

function DocIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M14 3v5h5" />
      <path d="M6 3h8l5 5v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
    </svg>
  );
}
