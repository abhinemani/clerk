"use client";

/**
 * Correspondence panel (staff side) — the request's message thread plus the
 * composer. AI drafts a clarification letter (§6.6) as a proposal card; the
 * staff member edits and sends (Accept/Edit/Dismiss, like triage). Sending is
 * a server action under the staff session — the named human on every outbound.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  draftReplyAction,
  sendMessageAction,
} from "../[agency]/app/(secure)/requests/[id]/actions";
import { AiPill } from "./ui";

export interface MessageVM {
  id: string;
  direction: "inbound" | "outbound" | "internal_note";
  subject: string | null;
  body: string;
  aiDrafted: boolean;
  senderName: string | null;
  atLabel: string;
}

interface DraftState {
  subject: string;
  body: string;
  aiDrafted: boolean;
  aiMeta?: { promptVersion: string; model: string };
  warnings: string[];
}

export function CorrespondencePanel(props: {
  agencySlug: string;
  requestId: string;
  messages: MessageVM[];
  /** Whether "ask for clarification" is a legal move from the current status. */
  canRequestClarification: boolean;
  /** The request is paused waiting on the requester. */
  awaitingReply: boolean;
  /** Requester has an email — sends will reach an inbox (via the outbox). */
  requesterReachable: boolean;
  requesterName: string;
  closed: boolean;
}) {
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [markClarification, setMarkClarification] = useState(false);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [usedDraft, setUsedDraft] = useState<DraftState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [drafting, startDrafting] = useTransition();

  const base = { agencySlug: props.agencySlug, requestId: props.requestId };

  function send(internal: boolean) {
    setError(null);
    startTransition(async () => {
      // The draft's provenance survives staff edits — the audit records that
      // the model proposed and a human disposed, whatever the final wording.
      const ai = !internal && usedDraft ? { aiDrafted: usedDraft.aiDrafted, aiMeta: usedDraft.aiMeta } : {};
      const result = await sendMessageAction({
        ...base,
        subject: subject.trim() || undefined,
        body,
        internal,
        requestClarification: !internal && markClarification,
        ...ai,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSubject("");
      setBody("");
      setMarkClarification(false);
      setUsedDraft(null);
      router.refresh();
    });
  }

  function requestDraft() {
    setError(null);
    startDrafting(async () => {
      const result = await draftReplyAction(base);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDraft({
        subject: result.subject,
        body: result.body,
        aiDrafted: result.aiDrafted,
        aiMeta: result.aiMeta,
        warnings: result.warnings,
      });
    });
  }

  return (
    <section className="card" style={{ overflow: "hidden" }}>
      <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
        <h2 style={{ fontSize: "1.05rem", margin: 0 }}>Correspondence</h2>
        {props.awaitingReply && (
          <span className="pill band-due_soon">Waiting on {props.requesterName}</span>
        )}
        <span className="muted" style={{ marginLeft: "auto", fontSize: "0.8rem" }}>
          {props.messages.length === 0
            ? "No messages yet"
            : `${props.messages.length} message${props.messages.length === 1 ? "" : "s"}`}
        </span>
      </div>

      {props.messages.length > 0 && (
        <ol style={{ listStyle: "none", margin: 0, padding: "14px 18px", display: "grid", gap: 10 }}>
          {props.messages.map((m) => (
            <li key={m.id} className="msg-row" data-dir={m.direction}>
              <div className="msg-head">
                <strong style={{ fontSize: "0.85rem" }}>
                  {m.direction === "inbound" ? props.requesterName : m.senderName ?? "Staff"}
                </strong>
                {m.direction === "internal_note" && <span className="tag">Internal</span>}
                {m.aiDrafted && <span className="tag">AI-drafted</span>}
                <span className="muted" style={{ fontSize: "0.75rem", marginLeft: "auto" }}>
                  {m.atLabel}
                </span>
              </div>
              {m.subject && <div style={{ fontWeight: 600, fontSize: "0.88rem", marginTop: 4 }}>{m.subject}</div>}
              <p style={{ fontSize: "0.9rem", marginTop: 4, whiteSpace: "pre-wrap" }}>{m.body}</p>
            </li>
          ))}
        </ol>
      )}

      {props.closed ? (
        <div className="muted" style={{ padding: "14px 18px", fontSize: "0.88rem", borderTop: "1px solid var(--border)" }}>
          Request closed — the thread above is the complete correspondence record.
        </div>
      ) : (
        <div style={{ padding: "14px 18px", borderTop: "1px solid var(--border)" }}>
          {draft && (
            <div className="ai-card" style={{ marginBottom: 12 }}>
              <div className="ai-head">
                <AiPill>{draft.aiDrafted ? "Drafted reply" : "Template reply"}</AiPill>
                <span className="muted" style={{ fontSize: "0.78rem", marginLeft: "auto" }}>
                  edit before sending
                </span>
              </div>
              <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{draft.subject}</div>
              <p style={{ fontSize: "0.88rem", marginTop: 6, whiteSpace: "pre-wrap" }}>{draft.body}</p>
              {draft.warnings.map((w) => (
                <div key={w} className="pill band-due_soon" style={{ marginTop: 8, display: "inline-flex" }}>
                  ⚠ {w}
                </div>
              ))}
              <div className="ai-actions">
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => {
                    setSubject(draft.subject);
                    setBody(draft.body);
                    setUsedDraft(draft);
                    setDraft(null);
                  }}
                >
                  Use draft
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => setDraft(null)}>
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {error && (
            <p className="pill band-overdue" role="alert" style={{ marginBottom: 10 }}>
              {error}
            </p>
          )}

          <input
            className="field"
            style={{ width: "100%" }}
            placeholder="Subject (optional)"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            aria-label="Message subject"
          />
          <textarea
            className="field"
            style={{ width: "100%", minHeight: 96, marginTop: 8, resize: "vertical" }}
            placeholder={`Write to ${props.requesterName}…`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            aria-label="Message body"
          />

          {!props.requesterReachable && (
            <p className="muted" style={{ fontSize: "0.8rem", marginTop: 6 }}>
              This requester left no email — the message is recorded on the request but nothing is
              emailed.
            </p>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button
              className="btn btn-sm btn-primary"
              disabled={pending || !body.trim()}
              onClick={() => send(false)}
            >
              {pending ? "Sending…" : "Send to requester"}
            </button>
            <button className="btn btn-sm" disabled={pending || !body.trim()} onClick={() => send(true)}>
              Save internal note
            </button>
            <button className="btn btn-sm btn-ghost" disabled={drafting} onClick={requestDraft}>
              {drafting ? "Drafting…" : "✦ Draft a clarification"}
            </button>
            {props.canRequestClarification && (
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.82rem", marginLeft: "auto" }}>
                <input
                  type="checkbox"
                  checked={markClarification}
                  onChange={(e) => setMarkClarification(e.target.checked)}
                />
                Pause as “needs clarification”
              </label>
            )}
          </div>
        </div>
      )}

      <style>{`
        .msg-row { border: 1px solid var(--border); border-radius: var(--r-sm); padding: 10px 12px; background: var(--surface); }
        .msg-row[data-dir="inbound"] { background: var(--surface-2); }
        .msg-row[data-dir="internal_note"] { border-style: dashed; opacity: 0.85; }
        .msg-head { display: flex; align-items: center; gap: 8px; }
      `}</style>
    </section>
  );
}
