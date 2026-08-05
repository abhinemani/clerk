"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  applyRedactions,
  findLeaks,
  redactedValues,
  spansFromDragRect,
  suggestRedactionsFromPii,
  type GridPoint,
  type RedactionSpan,
} from "@/domain/redaction";
import { finalizeRedactionAction } from "../[agency]/app/(secure)/requests/[id]/actions";
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
  /** One-sentence LLM rationale (exemption-pass suggestions only, §6.5). */
  rationale?: string;
  /** LLM confidence 0–1, shown so staff can triage the weak ones first. */
  confidence?: number;
  /** Shared by spans created in one multi-line drag — they act as a unit. */
  groupId?: string;
}

/** A §6.5 step-2 suggestion the exemption-pass job stored on the document. */
export interface ServerSuggestionVM {
  line: number;
  startCol: number;
  endCol: number;
  reason: string;
  confidence: number;
  rationale: string;
}

/** A live selection: two grid points; rendering derives the per-line rects. */
interface Selection {
  anchor: GridPoint;
  focus: GridPoint;
}

/**
 * Redaction Studio (§6.5). The official drags across the document to black out a
 * line or area; each region requires an exemption reason. AI pre-suggests regions
 * from the deterministic PII pass. Finalize burns ONLY accepted regions into a
 * true-redacted release (underlying text removed), verified leak-free.
 */
export interface FinalizedArtifactVM {
  filename: string;
  redactionCount: number;
  atLabel: string;
  /** The burned rendition's lines — the authoritative "released copy" view. */
  lines: string[];
}

/**
 * A PII-pass reason ("Personal privacy — SSN") mapped onto the agency's
 * configured exemption catalog, so a suggestion's picker never shows a reason
 * that isn't a real citation.
 */
function matchExemption(reason: string | undefined, options: string[]): string {
  if (reason && options.includes(reason)) return reason;
  const lower = (reason ?? "").toLowerCase();
  for (const kw of ["privacy", "law enforcement", "medical", "financial", "investigation"]) {
    if (!lower.includes(kw)) continue;
    const hit = options.find((o) => o.toLowerCase().includes(kw));
    if (hit) return hit;
  }
  return options.find((o) => o.toLowerCase().includes("privacy")) ?? options[0]!;
}

export function RedactionStudio({
  documentName,
  requestPublicId,
  lines,
  exemptions,
  live,
  serverSuggestions = [],
  finalizedArtifact = null,
}: {
  documentName: string;
  requestPublicId: string;
  lines: string[];
  exemptions: string[];
  /** Persist finalize through the server action (real request documents). */
  live?: { agencySlug: string; requestId: string; documentId: string };
  /** LLM exemption-pass suggestions computed off-path by the job (§6.5). */
  serverSuggestions?: ServerSuggestionVM[];
  /** The already-burned artifact for this document, when one exists. */
  finalizedArtifact?: FinalizedArtifactVM | null;
}) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const initial = useMemo<Redaction[]>(() => {
    const pii: Redaction[] = suggestRedactionsFromPii(lines).map((s, i) => ({
      id: `ai-${i}`,
      line: s.line,
      startCol: s.startCol,
      endCol: s.endCol,
      reason: matchExemption(s.reason, exemptions),
      source: "ai",
      status: "suggested",
    }));
    // Exemption-pass findings, deduped against overlapping PII hits (the
    // deterministic pass wins ties — it's cheaper to audit).
    const overlaps = (a: Redaction, b: { line: number; startCol: number; endCol: number }) =>
      a.line === b.line && a.startCol < b.endCol && b.startCol < a.endCol;
    const llm: Redaction[] = serverSuggestions
      .filter((s) => !pii.some((p) => overlaps(p, s)))
      .map((s, i) => ({
        id: `llm-${i}`,
        line: s.line,
        startCol: s.startCol,
        endCol: s.endCol,
        reason: matchExemption(s.reason, exemptions),
        source: "ai",
        status: "suggested",
        rationale: s.rationale,
        confidence: s.confidence,
      }));
    return [...pii, ...llm].sort((a, b) => a.line - b.line || a.startCol - b.startCol);
  }, [lines, exemptions, serverSuggestions]);

  const [redactions, setRedactions] = useState<Redaction[]>(initial);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [finalized, setFinalized] = useState(finalizedArtifact != null);
  /** Keyboard caret — also the anchor for shift+arrow selection. */
  const [caret, setCaret] = useState<GridPoint>({ line: 0, col: 0 });
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  function finalize(acceptResidualRisk = false) {
    if (!live) {
      setFinalized(true); // demo fixture — local preview only
      return;
    }
    setServerError(null);
    startSaving(async () => {
      const result = await finalizeRedactionAction({
        agencySlug: live.agencySlug,
        requestId: live.requestId,
        documentId: live.documentId,
        spans: accepted.map((r) => ({
          line: r.line,
          startCol: r.startCol,
          endCol: r.endCol,
          reason: r.reason,
        })),
        acceptResidualRisk,
      });
      if (!result.ok) {
        setServerError(result.error);
        return;
      }
      setFinalized(true);
      router.refresh(); // pull the artifact + review decision + audit event
    });
  }

  // The §6.5 residual-PII refusal is overridable — but only explicitly.
  const residualRefusal = serverError?.includes("Possible missed PII") ?? false;

  const docRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const charW = useRef(FONT_SIZE * 0.6);
  const draggingRef = useRef(false);

  useLayoutEffect(() => {
    if (measureRef.current) charW.current = measureRef.current.getBoundingClientRect().width / 10;
  }, []);

  const lineLengths = useMemo(() => lines.map((l) => l.length), [lines]);

  function locate(clientX: number, clientY: number): GridPoint {
    const el = docRef.current!;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left + el.scrollLeft;
    const y = clientY - rect.top + el.scrollTop;
    const line = Math.max(0, Math.min(Math.floor(y / LINE_H), lines.length - 1));
    const col = Math.max(0, Math.min(Math.round(x / charW.current), lines[line]!.length));
    return { line, col };
  }

  /** Turn the current selection into redactions — one span per covered line. */
  const commitSelection = useCallback(
    (sel: Selection | null) => {
      if (!sel) return;
      const spans = spansFromDragRect(lineLengths, sel.anchor, sel.focus);
      if (spans.length === 0) return;
      const groupId = `g-${sel.anchor.line}-${sel.anchor.col}-${sel.focus.line}-${sel.focus.col}`;
      setRedactions((prev) => [
        ...prev,
        ...spans.map((s, i) => ({
          id: `staff-${groupId}-${i}`,
          line: s.line,
          startCol: s.startCol,
          endCol: s.endCol,
          reason: exemptions[0]!,
          source: "staff" as const,
          status: "accepted" as const,
          groupId: spans.length > 1 ? groupId : undefined,
        })),
      ]);
    },
    [exemptions, lineLengths],
  );

  function onDown(e: React.MouseEvent) {
    if (finalized) return;
    const point = locate(e.clientX, e.clientY);
    draggingRef.current = true;
    setSelection({ anchor: point, focus: point });
    setCaret(point);
  }
  function onMove(e: React.MouseEvent) {
    if (!draggingRef.current) return;
    const point = locate(e.clientX, e.clientY);
    setSelection((prev) => (prev ? { ...prev, focus: point } : prev));
  }
  function onUp(e?: React.MouseEvent) {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setSelection((prev) => {
      const sel = prev && e ? { ...prev, focus: locate(e.clientX, e.clientY) } : prev;
      commitSelection(sel);
      return null;
    });
  }

  /**
   * Keyboard redaction — arrows move the caret, shift+arrows extend a
   * selection, Enter burns it. A records office should never need a mouse to
   * do the legally significant part of this job.
   */
  function onKeyDown(e: React.KeyboardEvent) {
    if (finalized) return;
    const key = e.key;
    // Compute from the CURRENT caret and set both states directly — a state
    // updater must stay pure, so no setSelection inside setCaret.
    const move = (dLine: number, dCol: number) => {
      e.preventDefault();
      const line = Math.max(0, Math.min(caret.line + dLine, lines.length - 1));
      const maxCol = lines[line]!.length;
      const col = dLine !== 0 ? Math.min(caret.col, maxCol) : Math.max(0, Math.min(caret.col + dCol, maxCol));
      const next = { line, col };
      setCaret(next);
      setSelection(e.shiftKey ? { anchor: selection?.anchor ?? caret, focus: next } : null);
    };
    if (key === "ArrowLeft") return move(0, -1);
    if (key === "ArrowRight") return move(0, 1);
    if (key === "ArrowUp") return move(-1, 0);
    if (key === "ArrowDown") return move(1, 0);
    if (key === "Home") {
      e.preventDefault();
      setCaret((p) => ({ ...p, col: 0 }));
      return;
    }
    if (key === "End") {
      e.preventDefault();
      setCaret((p) => ({ ...p, col: lines[p.line]!.length }));
      return;
    }
    if (key === "Enter") {
      e.preventDefault();
      commitSelection(selection);
      setSelection(null);
      return;
    }
    if (key === "Escape") {
      e.preventDefault();
      setSelection(null);
    }
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

  // Finalized view shows the burned rendition itself when we have it — the
  // authoritative released copy, not a client-side reconstruction.
  const displayLines = finalized ? (finalizedArtifact?.lines ?? releasedLines) : lines;

  function update(id: string, patch: Partial<Redaction>) {
    setRedactions((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function remove(id: string) {
    // A multi-line drag is one act — removing any part removes the whole.
    setRedactions((prev) => {
      const target = prev.find((r) => r.id === id);
      if (target?.groupId) return prev.filter((r) => r.groupId !== target.groupId);
      return prev.filter((r) => r.id !== id);
    });
  }
  function acceptAll() {
    setRedactions((prev) => prev.map((r) => (r.status === "suggested" ? { ...r, status: "accepted" } : r)));
  }
  function rejectAll() {
    setRedactions((prev) => prev.filter((r) => r.status !== "suggested"));
  }
  /** Group-level triage — the whole point of the AI panel: decide by reason. */
  function acceptGroup(reason: string) {
    setRedactions((prev) =>
      prev.map((r) => (r.status === "suggested" && r.reason === reason ? { ...r, status: "accepted" } : r)),
    );
  }
  function rejectGroup(reason: string) {
    setRedactions((prev) => prev.filter((r) => !(r.status === "suggested" && r.reason === reason)));
  }

  /** Scroll a redaction into view and flash focus on it. */
  const jumpTo = useCallback((r: Redaction) => {
    setFocusedId(r.id);
    const el = docRef.current;
    if (el) el.scrollTo({ top: Math.max(0, r.line * LINE_H - el.clientHeight / 2), behavior: "smooth" });
  }, []);

  const suggestions = redactions.filter((r) => r.status === "suggested");
  /** Suggestions bucketed by exemption reason, worst-confidence first. */
  const suggestionGroups = useMemo(() => {
    const byReason = new Map<string, Redaction[]>();
    for (const s of suggestions) {
      const list = byReason.get(s.reason) ?? [];
      list.push(s);
      byReason.set(s.reason, list);
    }
    return [...byReason.entries()]
      .map(([reason, items]) => ({
        reason,
        items,
        minConfidence: Math.min(...items.map((i) => i.confidence ?? 1)),
      }))
      .sort((a, b) => a.minConfidence - b.minConfidence);
  }, [suggestions]);

  const reviewedCount = initial.length - suggestions.length;

  /** In-document search — highlights matches; "redact all" acts on every hit. */
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [] as RedactionSpan[];
    const found: RedactionSpan[] = [];
    lines.forEach((text, line) => {
      const hay = text.toLowerCase();
      let from = 0;
      for (;;) {
        const at = hay.indexOf(q, from);
        if (at < 0) break;
        found.push({ line, startCol: at, endCol: at + q.length });
        from = at + q.length;
      }
    });
    return found;
  }, [query, lines]);

  function redactAllMatches() {
    if (matches.length === 0) return;
    const groupId = `find-${query.trim().toLowerCase()}`;
    setRedactions((prev) => [
      ...prev.filter((r) => r.groupId !== groupId),
      ...matches.map((m, i) => ({
        id: `staff-${groupId}-${i}`,
        line: m.line,
        startCol: m.startCol,
        endCol: m.endCol,
        reason: exemptions[0]!,
        source: "staff" as const,
        status: "accepted" as const,
        groupId,
      })),
    ]);
  }

  // Escape clears search focus from anywhere in the studio.
  useEffect(() => {
    if (!finalized) return;
    setSelection(null);
  }, [finalized]);

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
          {finalized && (
            <span className="pill band-on_track" style={{ marginLeft: "auto" }}>
              Released copy
            </span>
          )}
        </div>

        {/* Find-and-redact: the fastest path to "black out every mention". */}
        {!finalized && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
            <input
              className="field"
              style={{ fontSize: "0.85rem", padding: "6px 10px", width: 220 }}
              placeholder="Find in document…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Find text in document"
            />
            {matches.length > 0 && (
              <>
                <span className="muted" style={{ fontSize: "0.82rem" }}>
                  {matches.length} match{matches.length === 1 ? "" : "es"}
                </span>
                <button className="btn btn-sm" onClick={redactAllMatches}>
                  Redact all matches
                </button>
              </>
            )}
            {query.trim().length >= 2 && matches.length === 0 && (
              <span className="muted" style={{ fontSize: "0.82rem" }}>No matches</span>
            )}
            <span className="muted" style={{ fontSize: "0.8rem", marginLeft: "auto" }}>
              Drag across text — or use arrow keys, shift to select, Enter to black out
            </span>
          </div>
        )}

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
            onKeyDown={onKeyDown}
            tabIndex={finalized ? -1 : 0}
            role="textbox"
            aria-multiline="true"
            aria-readonly="true"
            aria-label={
              finalized
                ? "Released copy of the document"
                : "Document text — drag, or use arrow keys with shift to select and Enter to redact"
            }
            style={{ cursor: finalized ? "default" : "crosshair" }}
          >
            {displayLines.map((text, i) => (
              <div key={i} className="doc-line" style={{ height: LINE_H }}>
                {text.length ? text : " "}
              </div>
            ))}

            {/* Search highlights sit UNDER the bars — a redacted match stays
                redacted; the highlight only helps you find things. */}
            {!finalized &&
              matches.map((m, i) => (
                <div
                  key={`m-${i}`}
                  className="bar bar-find"
                  style={{
                    left: m.startCol * charW.current,
                    top: m.line * LINE_H,
                    width: (m.endCol - m.startCol) * charW.current,
                    height: LINE_H,
                  }}
                />
              ))}

            {/* Redaction overlays (edit mode only; finalized burns into the text) */}
            {!finalized &&
              redactions.map((r) => (
                <div
                  key={r.id}
                  className={`bar ${
                    revealedId === r.id
                      ? "bar-reveal"
                      : r.status === "accepted"
                        ? "bar-black"
                        : "bar-ai"
                  }${focusedId === r.id ? " bar-focused" : ""}`}
                  style={{
                    left: r.startCol * charW.current,
                    top: r.line * LINE_H,
                    width: (r.endCol - r.startCol) * charW.current,
                    height: LINE_H,
                  }}
                  title={r.reason}
                />
              ))}

            {/* Live selection — one rect per covered line (multi-line drags) */}
            {selection &&
              spansFromDragRect(lineLengths, selection.anchor, selection.focus).map((s, i) => (
                <div
                  key={`sel-${i}`}
                  className="bar bar-draft"
                  style={{
                    left: s.startCol * charW.current,
                    top: s.line * LINE_H,
                    width: (s.endCol - s.startCol) * charW.current,
                    height: LINE_H,
                  }}
                />
              ))}

            {/* Keyboard caret */}
            {!finalized && (
              <div
                className="caret"
                style={{ left: caret.col * charW.current, top: caret.line * LINE_H, height: LINE_H }}
                aria-hidden
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

        {/* AI triage — decide by exemption reason, not one span at a time.
            Every accept here is still an explicit human act. */}
        {suggestions.length > 0 && !finalized && (
          <div className="ai-card">
            <div className="ai-head">
              <AiPill>AI suggestions</AiPill>
              <span style={{ fontSize: "0.85rem", fontWeight: 600, marginLeft: "auto" }}>
                {reviewedCount} of {initial.length} reviewed
              </span>
            </div>
            <p className="muted" style={{ fontSize: "0.85rem" }}>
              A deterministic PII scan plus the exemption pass flagged these. AI never redacts on its
              own — accept, edit the citation, or reject each one.
            </p>

            <div style={{ display: "grid", gap: 8, marginTop: 4 }}>
              {suggestionGroups.map((g) => (
                <div key={g.reason} style={{ border: "1px solid var(--border)", borderRadius: "var(--r)", padding: "8px 10px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <strong style={{ fontSize: "0.85rem" }}>{g.reason}</strong>
                    <span className="pill" style={{ fontSize: "0.72rem" }}>{g.items.length}</span>
                    {g.minConfidence < 1 && (
                      <span
                        className="muted"
                        style={{ fontSize: "0.75rem" }}
                        title="Lowest model confidence in this group — review these first"
                      >
                        as low as {Math.round(g.minConfidence * 100)}%
                      </span>
                    )}
                    <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                      <button className="btn btn-sm btn-primary" onClick={() => acceptGroup(g.reason)}>
                        Accept {g.items.length}
                      </button>
                      <button className="btn btn-sm btn-ghost" onClick={() => rejectGroup(g.reason)}>
                        Reject
                      </button>
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div className="ai-actions" style={{ marginTop: 8 }}>
              <button className="btn btn-sm btn-primary" onClick={acceptAll}>
                Accept all {suggestions.length}
              </button>
              <button className="btn btn-sm btn-ghost" onClick={rejectAll}>
                Reject all
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
                  {/* Covered text is masked by default and revealed on hover:
                      reviewing WHAT you are hiding shouldn't require unhiding it
                      on screen for everyone walking past the desk. */}
                  <span
                    className={`covered${revealedId === r.id ? " revealed" : ""}`}
                    onMouseEnter={() => setRevealedId(r.id)}
                    onMouseLeave={() => setRevealedId((cur) => (cur === r.id ? null : cur))}
                    onFocus={() => setRevealedId(r.id)}
                    onBlur={() => setRevealedId((cur) => (cur === r.id ? null : cur))}
                    tabIndex={0}
                    title="Hover to reveal the covered text"
                  >
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
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                  <button
                    className="muted mono"
                    onClick={() => jumpTo(r)}
                    style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: "0.72rem", textDecoration: "underline" }}
                    title="Scroll to this spot in the document"
                  >
                    line {r.line + 1}
                  </button>
                  {r.groupId && <span className="tag" style={{ fontSize: "0.68rem" }}>multi-line</span>}
                  {r.confidence != null && (
                    <span className="muted" style={{ fontSize: "0.72rem" }}>
                      {Math.round(r.confidence * 100)}% confident
                    </span>
                  )}
                </div>
                {r.rationale && (
                  <div className="muted" style={{ fontSize: "0.78rem", marginTop: 4 }}>
                    <SparkIcon /> {r.rationale}
                  </div>
                )}
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

        {serverError && (
          <p className="pill band-overdue" role="alert">
            {serverError}
          </p>
        )}
        {residualRefusal && !finalized && (
          <button className="btn btn-sm" disabled={saving} onClick={() => finalize(true)}>
            Accept flagged risk &amp; burn anyway (recorded under your name)
          </button>
        )}

        {!finalized ? (
          <>
            {pendingSuggestions > 0 && (
              <div className="pill band-due_soon" style={{ fontSize: "0.82rem" }}>
                {pendingSuggestions} AI suggestion{pendingSuggestions === 1 ? "" : "s"} not yet actioned
              </div>
            )}
            <button
              className="btn btn-primary"
              disabled={accepted.length === 0 || saving}
              onClick={() => finalize()}
            >
              {saving
                ? "Burning…"
                : `Finalize & burn ${accepted.length} redaction${accepted.length === 1 ? "" : "s"}`}
            </button>
            {live && (
              <p className="muted" style={{ fontSize: "0.78rem", margin: 0 }}>
                Finalizing regenerates the release copy from the surviving text only, verifies the
                burn, and records your name on the release-with-redactions decision.
              </p>
            )}
          </>
        ) : (
          <>
            <div className="card" style={{ padding: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: leaks.length ? "var(--overdue)" : "var(--ok)" }}>
                {leaks.length === 0 ? "✓" : "⚠"}
                <strong style={{ fontSize: "0.9rem" }}>
                  {finalizedArtifact
                    ? `${finalizedArtifact.redactionCount} redaction${finalizedArtifact.redactionCount === 1 ? "" : "s"} burned into ${finalizedArtifact.filename}`
                    : leaks.length === 0
                      ? `${accepted.length} value${accepted.length === 1 ? "" : "s"} burned — verified absent from the release`
                      : `${leaks.length} value(s) still present`}
                </strong>
              </div>
              <p className="muted" style={{ fontSize: "0.82rem", marginTop: 6 }}>
                {finalizedArtifact
                  ? `Finalized ${finalizedArtifact.atLabel}. The burned copy is what a release ships — the original never leaves.`
                  : "True redaction: the underlying text is removed, not covered. The exemption log ships with the response letter."}
              </p>
            </div>
            <button className="btn" onClick={() => setFinalized(false)}>
              ← Re-open for edits
            </button>
            {finalizedArtifact && (
              <p className="muted" style={{ fontSize: "0.78rem", margin: 0 }}>
                Re-finalizing creates a new burned copy; earlier versions stay on record.
              </p>
            )}
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
        .doc:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
        .bar { position: absolute; border-radius: 2px; pointer-events: none; }
        .bar-black { background: #111; }
        .bar-ai { background: repeating-linear-gradient(45deg, rgba(180,120,0,.28), rgba(180,120,0,.28) 6px, rgba(180,120,0,.14) 6px, rgba(180,120,0,.14) 12px);
          border: 1.5px solid #b07d18; }
        .bar-draft { background: rgba(17,17,17,.35); border: 1.5px solid #111; }
        /* Hover-reveal: the bar lifts so staff can read what's underneath. */
        .bar-reveal { background: rgba(17,17,17,.10); border: 1.5px dashed #111; }
        .bar-focused { box-shadow: 0 0 0 3px var(--accent); }
        .bar-find { background: rgba(201,162,39,.45); border-radius: 1px; }
        .caret { position: absolute; width: 2px; background: var(--accent); pointer-events: none;
          animation: caret-blink 1.1s step-end infinite; }
        @keyframes caret-blink { 50% { opacity: 0; } }
        @media (prefers-reduced-motion: reduce) { .caret { animation: none; } }
        /* Covered text stays masked until deliberately revealed. */
        .covered { font-family: var(--font-mono); font-size: 0.82rem; border-radius: 3px;
          padding: 0 4px; background: var(--ink); color: transparent; cursor: help; }
        .covered.revealed { background: var(--surface-3); color: var(--ink); }
        .covered:focus-visible { outline: 2px solid var(--accent); }
      `}</style>
    </div>
  );
}
