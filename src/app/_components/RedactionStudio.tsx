"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  applyRedactions,
  findLeaks,
  redactedValues,
  suggestRedactionsFromPii,
  type RedactionSpan,
} from "@/domain/redaction";
import { AiPill, SparkIcon } from "./ui";

const FONT_SIZE = 15;
const LINE_H = 26;

interface Redaction {
  id: string;
  line: number;
  startCol: number;
  endCol: number;
  reason: string;
  source: "staff" | "ai";
  status: "suggested" | "accepted";
}

interface Draft {
  line: number;
  startCol: number;
  endCol: number;
}

/**
 * Redaction Studio (§6.5). The official drags across the document to black out a
 * line or area; each region requires an exemption reason. AI pre-suggests regions
 * from the deterministic PII pass. Finalize burns ONLY accepted regions into a
 * true-redacted release (underlying text removed), verified leak-free.
 */
export function RedactionStudio({
  documentName,
  requestPublicId,
  lines,
  exemptions,
}: {
  documentName: string;
  requestPublicId: string;
  lines: string[];
  exemptions: string[];
}) {
  const initial = useMemo<Redaction[]>(
    () =>
      suggestRedactionsFromPii(lines).map((s, i) => ({
        id: `ai-${i}`,
        line: s.line,
        startCol: s.startCol,
        endCol: s.endCol,
        reason: s.reason ?? exemptions[0]!,
        source: "ai",
        status: "suggested",
      })),
    [lines, exemptions],
  );

  const [redactions, setRedactions] = useState<Redaction[]>(initial);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [finalized, setFinalized] = useState(false);

  const docRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const charW = useRef(FONT_SIZE * 0.6);
  const dragRef = useRef<{ line: number; startCol: number } | null>(null);

  useLayoutEffect(() => {
    if (measureRef.current) charW.current = measureRef.current.getBoundingClientRect().width / 10;
  }, []);

  function locate(clientX: number, clientY: number) {
    const el = docRef.current!;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left + el.scrollLeft;
    const y = clientY - rect.top + el.scrollTop;
    const line = Math.max(0, Math.min(Math.floor(y / LINE_H), lines.length - 1));
    const col = Math.max(0, Math.min(Math.round(x / charW.current), lines[line]!.length));
    return { line, col };
  }

  function onDown(e: React.MouseEvent) {
    if (finalized) return;
    const { line, col } = locate(e.clientX, e.clientY);
    dragRef.current = { line, startCol: col };
    setDraft({ line, startCol: col, endCol: col });
  }
  function onMove(e: React.MouseEvent) {
    if (!dragRef.current) return;
    const { col } = locate(e.clientX, e.clientY);
    setDraft({ line: dragRef.current.line, startCol: dragRef.current.startCol, endCol: col });
  }
  function onUp(e?: React.MouseEvent) {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    // Compute the end from the mouseup event directly, so a plain down→up drag
    // (no intervening move) still redacts.
    const endCol = e ? locate(e.clientX, e.clientY).col : (draft?.endCol ?? drag.startCol);
    const startCol = Math.min(drag.startCol, endCol);
    const finalEnd = Math.max(drag.startCol, endCol);
    if (finalEnd - startCol >= 1) {
      setRedactions((prev) => [
        ...prev,
        {
          id: `staff-${prev.length}-${startCol}`,
          line: drag.line,
          startCol,
          endCol: finalEnd,
          reason: exemptions[0]!,
          source: "staff",
          status: "accepted",
        },
      ]);
    }
    setDraft(null);
  }

  const accepted = redactions.filter((r) => r.status === "accepted");
  const pendingSuggestions = redactions.filter((r) => r.status === "suggested").length;

  const acceptedSpans: RedactionSpan[] = accepted.map((r) => ({
    line: r.line,
    startCol: r.startCol,
    endCol: r.endCol,
    reason: r.reason,
  }));
  const releasedLines = applyRedactions(lines, acceptedSpans);
  const leaks = findLeaks(releasedLines, redactedValues(lines, acceptedSpans));

  const displayLines = finalized ? releasedLines : lines;

  function update(id: string, patch: Partial<Redaction>) {
    setRedactions((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function remove(id: string) {
    setRedactions((prev) => prev.filter((r) => r.id !== id));
  }
  function acceptAll() {
    setRedactions((prev) => prev.map((r) => (r.status === "suggested" ? { ...r, status: "accepted" } : r)));
  }

  return (
    <div className="redact-grid">
      {/* Document viewer */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <span className="mono muted" style={{ fontSize: "0.85rem" }}>
            {documentName}
          </span>
          <span className="muted" style={{ fontSize: "0.85rem" }}>
            · {requestPublicId}
          </span>
          {!finalized && (
            <span className="muted" style={{ fontSize: "0.82rem", marginLeft: "auto" }}>
              Drag across text to black out ▚
            </span>
          )}
          {finalized && (
            <span className="pill band-on_track" style={{ marginLeft: "auto" }}>
              Released copy
            </span>
          )}
        </div>

        <div className={`page${finalized ? " finalized" : ""}`}>
          <span ref={measureRef} className="measure" aria-hidden>
            MMMMMMMMMM
          </span>
          <div
            ref={docRef}
            className="doc"
            onMouseDown={onDown}
            onMouseMove={onMove}
            onMouseUp={onUp}
            onMouseLeave={onUp}
            role="application"
            aria-label="Document — drag to redact"
            style={{ cursor: finalized ? "default" : "crosshair" }}
          >
            {displayLines.map((text, i) => (
              <div key={i} className="doc-line" style={{ height: LINE_H }}>
                {text.length ? text : " "}
              </div>
            ))}

            {/* Redaction overlays (edit mode only; finalized burns into the text) */}
            {!finalized &&
              redactions.map((r) => (
                <div
                  key={r.id}
                  className={`bar ${r.status === "accepted" ? "bar-black" : "bar-ai"}`}
                  style={{
                    left: r.startCol * charW.current,
                    top: r.line * LINE_H,
                    width: (r.endCol - r.startCol) * charW.current,
                    height: LINE_H,
                  }}
                  title={r.reason}
                />
              ))}

            {/* Live draft rectangle */}
            {draft && (
              <div
                className="bar bar-draft"
                style={{
                  left: Math.min(draft.startCol, draft.endCol) * charW.current,
                  top: draft.line * LINE_H,
                  width: Math.abs(draft.endCol - draft.startCol) * charW.current,
                  height: LINE_H,
                }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Exemption log / controls */}
      <aside className="stack" style={{ gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div className="panel-title">Exemption log</div>
          <span className="pill">{accepted.length} redaction{accepted.length === 1 ? "" : "s"}</span>
        </div>

        {pendingSuggestions > 0 && !finalized && (
          <div className="ai-card">
            <div className="ai-head">
              <AiPill>PII pre-scan</AiPill>
              <span style={{ fontSize: "0.85rem", fontWeight: 600, marginLeft: "auto" }}>
                {pendingSuggestions} suggested
              </span>
            </div>
            <p className="muted" style={{ fontSize: "0.85rem" }}>
              Detected likely PII. Accept to redact, or reject. AI never auto-redacts — you decide.
            </p>
            <div className="ai-actions">
              <button className="btn btn-sm btn-primary" onClick={acceptAll}>
                Accept all
              </button>
            </div>
          </div>
        )}

        {!finalized && (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
            {redactions.length === 0 && (
              <li className="muted" style={{ fontSize: "0.9rem" }}>
                No redactions yet. Drag across the document to add one.
              </li>
            )}
            {redactions.map((r) => (
              <li key={r.id} className="card" style={{ padding: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="mono" style={{ fontSize: "0.82rem", background: "var(--ink)", color: "var(--ink)", borderRadius: 3, padding: "0 4px" }}>
                    {lines[r.line]!.slice(r.startCol, r.endCol) || "—"}
                  </span>
                  <span
                    className={`pill ${r.status === "accepted" ? "band-on_track" : "pill-ai"}`}
                    style={{ marginLeft: "auto", fontSize: "0.72rem" }}
                  >
                    {r.source === "ai" ? "AI" : "You"}
                    {r.status === "accepted" ? " · on" : " · suggested"}
                  </span>
                </div>
                <div className="muted mono" style={{ fontSize: "0.72rem", marginTop: 4 }}>
                  line {r.line + 1}
                </div>
                <select
                  className="field"
                  style={{ marginTop: 8, padding: "7px 10px", fontSize: "0.85rem" }}
                  value={r.reason}
                  onChange={(e) => update(r.id, { reason: e.target.value })}
                  aria-label="Exemption reason"
                >
                  {exemptions.map((ex) => (
                    <option key={ex} value={ex}>
                      {ex}
                    </option>
                  ))}
                </select>
                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  {r.status === "suggested" ? (
                    <>
                      <button className="btn btn-sm btn-primary" onClick={() => update(r.id, { status: "accepted" })}>
                        Accept
                      </button>
                      <button className="btn btn-sm btn-ghost" onClick={() => remove(r.id)}>
                        Reject
                      </button>
                    </>
                  ) : (
                    <button className="btn btn-sm btn-ghost" onClick={() => remove(r.id)}>
                      Remove
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        <hr className="divider" />

        {!finalized ? (
          <>
            {pendingSuggestions > 0 && (
              <div className="pill band-due_soon" style={{ fontSize: "0.82rem" }}>
                {pendingSuggestions} AI suggestion{pendingSuggestions === 1 ? "" : "s"} not yet actioned
              </div>
            )}
            <button
              className="btn btn-primary"
              disabled={accepted.length === 0}
              onClick={() => setFinalized(true)}
            >
              Finalize &amp; burn {accepted.length} redaction{accepted.length === 1 ? "" : "s"}
            </button>
          </>
        ) : (
          <>
            <div className="card" style={{ padding: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: leaks.length ? "var(--overdue)" : "var(--ok)" }}>
                {leaks.length === 0 ? "✓" : "⚠"}
                <strong style={{ fontSize: "0.9rem" }}>
                  {leaks.length === 0
                    ? `${accepted.length} value${accepted.length === 1 ? "" : "s"} burned — verified absent from the release`
                    : `${leaks.length} value(s) still present`}
                </strong>
              </div>
              <p className="muted" style={{ fontSize: "0.82rem", marginTop: 6 }}>
                True redaction: the underlying text is removed, not covered. The exemption log ships
                with the response letter.
              </p>
            </div>
            <button className="btn" onClick={() => setFinalized(false)}>
              ← Back to editing
            </button>
          </>
        )}
      </aside>

      <style>{`
        .redact-grid { display: grid; grid-template-columns: 1fr 320px; gap: 24px; align-items: start; }
        @media (max-width: 960px) { .redact-grid { grid-template-columns: 1fr; } }
        .page { background: #fff; border: 1px solid var(--border-strong); border-radius: var(--r);
          box-shadow: var(--shadow); padding: 28px 30px; overflow-x: auto; position: relative; }
        .page.finalized { background: #fbfbfa; }
        .measure { position: absolute; visibility: hidden; font-family: var(--font-mono);
          font-size: ${FONT_SIZE}px; white-space: pre; }
        .doc { position: relative; font-family: var(--font-mono); font-size: ${FONT_SIZE}px;
          line-height: ${LINE_H}px; color: #16181b; white-space: pre; user-select: none; min-width: 540px; }
        .doc-line { white-space: pre; }
        .bar { position: absolute; border-radius: 2px; pointer-events: none; }
        .bar-black { background: #111; }
        .bar-ai { background: repeating-linear-gradient(45deg, rgba(180,120,0,.28), rgba(180,120,0,.28) 6px, rgba(180,120,0,.14) 6px, rgba(180,120,0,.14) 12px);
          border: 1.5px solid #b07d18; }
        .bar-draft { background: rgba(17,17,17,.35); border: 1.5px solid #111; }
      `}</style>
    </div>
  );
}
