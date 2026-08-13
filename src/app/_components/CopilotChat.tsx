"use client";

/**
 * Coordinator copilot panel (§6.8) — chat scoped to one request. The model
 * answers and PROPOSES; nothing executes from here except through the same
 * named-human actions as the rest of the workspace: a drafted message is
 * editable in place and sends via sendMessageAction under the staff session;
 * task/extension proposals point at their panels. Accept / Edit / Dismiss,
 * the house grammar (§8).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  copilotAction,
  sendMessageAction,
  type CopilotActionVM,
} from "../[agency]/app/(secure)/requests/[id]/actions";
import { firePrefillDispatch, firePrefillExtension } from "./prefillEvents";
import { AiPill } from "./ui";

interface Turn {
  role: "coordinator" | "copilot";
  text: string;
  actions?: (CopilotActionVM & {
    draft?: string;
    sent?: boolean;
    dismissed?: boolean;
    /** Proposal handed to its panel, prefilled — awaiting the human there. */
    handed?: boolean;
  })[];
  aiMeta?: { promptVersion: string; model: string };
}

const ACTION_LABEL: Record<string, string> = {
  draft_message: "Drafted message to the requester",
  propose_task: "Proposed department task",
  propose_extension: "Proposed statutory extension",
};

export function CopilotChat({
  agencySlug,
  requestId,
  requesterName,
}: {
  agencySlug: string;
  requestId: string;
  requesterName: string;
}) {
  const router = useRouter();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function ask() {
    const message = input.trim();
    if (!message || pending) return;
    setError(null);
    setInput("");
    setTurns((prev) => [...prev, { role: "coordinator", text: message }]);
    startTransition(async () => {
      const history = turns.slice(-8).map((t) => `${t.role}: ${t.text}`);
      const result = await copilotAction({ agencySlug, requestId, message, history });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setTurns((prev) => [
        ...prev,
        {
          role: "copilot",
          text: result.reply,
          actions: result.actions.map((a) => ({ ...a, draft: a.detail })),
          aiMeta: result.aiMeta,
        },
      ]);
      router.refresh(); // the consult itself is now on the audit timeline
    });
  }

  function updateAction(turnIdx: number, actionIdx: number, patch: Record<string, unknown>) {
    setTurns((prev) =>
      prev.map((t, i) =>
        i === turnIdx
          ? { ...t, actions: t.actions?.map((a, j) => (j === actionIdx ? { ...a, ...patch } : a)) }
          : t,
      ),
    );
  }

  function sendDraft(turnIdx: number, actionIdx: number) {
    const turn = turns[turnIdx];
    const action = turn?.actions?.[actionIdx];
    if (!action?.draft?.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await sendMessageAction({
        agencySlug,
        requestId,
        body: action.draft!,
        aiDrafted: true,
        aiMeta: turn!.aiMeta,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      updateAction(turnIdx, actionIdx, { sent: true });
      router.refresh();
    });
  }

  return (
    <div className="ai-card">
      <div className="ai-head">
        <AiPill>Copilot</AiPill>
        <span className="muted" style={{ fontSize: "0.78rem", marginLeft: "auto" }}>
          proposes only — you dispose
        </span>
      </div>

      {turns.length === 0 && (
        <p className="muted" style={{ fontSize: "0.85rem", margin: 0 }}>
          Ask about this request — &ldquo;what&apos;s blocking this?&rdquo;, &ldquo;draft a status
          update&rdquo;, &ldquo;should we take the extension?&rdquo;
        </p>
      )}

      {turns.length > 0 && (
        <div style={{ display: "grid", gap: 8, maxHeight: 320, overflowY: "auto" }}>
          {turns.map((t, ti) => (
            <div key={ti}>
              <div
                style={{
                  fontSize: "0.88rem",
                  whiteSpace: "pre-wrap",
                  background: t.role === "coordinator" ? "var(--surface-2)" : "transparent",
                  borderRadius: "var(--r-sm)",
                  padding: t.role === "coordinator" ? "6px 10px" : 0,
                }}
              >
                {t.role === "coordinator" ? t.text : t.text}
              </div>
              {t.actions?.map((a, ai) =>
                a.dismissed ? null : (
                  <div
                    key={ai}
                    className="card"
                    style={{ marginTop: 6, padding: 10, background: "var(--surface)" }}
                  >
                    <div style={{ fontSize: "0.78rem", fontWeight: 600 }}>
                      {ACTION_LABEL[a.type] ?? a.type}
                    </div>
                    {a.type === "draft_message" ? (
                      a.sent ? (
                        <div className="pill band-on_track" style={{ marginTop: 6 }}>
                          ✓ Sent to {requesterName} under your name
                        </div>
                      ) : (
                        <>
                          <textarea
                            className="field"
                            rows={4}
                            style={{ marginTop: 6, fontSize: "0.82rem" }}
                            value={a.draft}
                            onChange={(e) => updateAction(ti, ai, { draft: e.target.value })}
                            aria-label="Edit the drafted message"
                          />
                          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                            <button
                              className="btn btn-sm btn-primary"
                              disabled={pending}
                              onClick={() => sendDraft(ti, ai)}
                            >
                              Send to requester
                            </button>
                            <button
                              className="btn btn-sm btn-ghost"
                              onClick={() => updateAction(ti, ai, { dismissed: true })}
                            >
                              Dismiss
                            </button>
                          </div>
                        </>
                      )
                    ) : (
                      <>
                        <p style={{ fontSize: "0.82rem", margin: "6px 0 0", whiteSpace: "pre-wrap" }}>
                          {a.detail}
                        </p>
                        {a.handed ? (
                          <div className="pill band-on_track" style={{ marginTop: 6 }}>
                            ✓ Prefilled — review it in the{" "}
                            {a.type === "propose_extension" ? "Statutory deadline panel" : "dispatch form"}
                          </div>
                        ) : (
                          <>
                            <p className="muted" style={{ fontSize: "0.75rem", margin: "6px 0 0" }}>
                              {a.type === "propose_extension"
                                ? "Prefills the Statutory deadline panel — the statute engine validates, you decide."
                                : "Prefills the dispatch form — you pick the department and send."}
                            </p>
                            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                              <button
                                className="btn btn-sm btn-primary"
                                onClick={() => {
                                  if (a.type === "propose_extension") firePrefillExtension({ note: a.detail });
                                  else firePrefillDispatch({ scope: a.detail });
                                  updateAction(ti, ai, { handed: true });
                                }}
                              >
                                {a.type === "propose_extension" ? "Prefill the extension panel" : "Prefill a dispatch"}
                              </button>
                              <button
                                className="btn btn-sm btn-ghost"
                                onClick={() => updateAction(ti, ai, { dismissed: true })}
                              >
                                Dismiss
                              </button>
                            </div>
                          </>
                        )}
                      </>
                    )}
                  </div>
                ),
              )}
            </div>
          ))}
        </div>
      )}

      {error && (
        <p className="pill band-overdue" role="alert" style={{ marginTop: 8 }}>
          {error}
        </p>
      )}

      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
        <input
          className="field"
          style={{ flex: 1, fontSize: "0.85rem" }}
          placeholder="Ask the copilot…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ask()}
          aria-label="Message the copilot"
        />
        <button className="btn btn-sm btn-primary" disabled={pending || !input.trim()} onClick={ask}>
          {pending ? "…" : "Ask"}
        </button>
      </div>
    </div>
  );
}
