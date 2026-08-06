"use client";

/**
 * Visual redaction studio (spec §6.5; invariant 1 — image documents).
 * Drag rectangles over the rendered page; every box carries an exemption
 * reason; Finalize burns the pixels SERVER-SIDE and mints an image-only PDF.
 * Boxes here are proposals — nothing is redacted until the named human
 * finalizes, exactly like the text studio.
 */
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { finalizeVisualRedactionAction } from "../[agency]/app/(secure)/requests/[id]/actions";

export interface VisualBoxVM {
  id: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  reason: string;
}

export interface VisualFinalizedVM {
  filename: string;
  redactionCount: number;
  pageCount: number;
  atLabel: string;
  artifactUrl: string;
}

export function VisualRedactionStudio({
  agencySlug,
  requestId,
  documentId,
  documentName,
  pageCount,
  exemptions,
  finalized,
}: {
  agencySlug: string;
  requestId: string;
  documentId: string;
  documentName: string;
  pageCount: number;
  exemptions: string[];
  finalized: VisualFinalizedVM | null;
}) {
  const [boxes, setBoxes] = useState<VisualBoxVM[]>([]);
  const [page, setPage] = useState(0);
  const [reason, setReason] = useState(exemptions[0] ?? "Exempt");
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const pageBoxes = useMemo(() => boxes.filter((b) => b.page === page), [boxes, page]);
  const pageUrl = `/${agencySlug}/app/requests/${requestId}/redact-visual/${documentId}/page/${page}`;

  function norm(e: React.PointerEvent): { x: number; y: number } {
    const rect = surfaceRef.current!.getBoundingClientRect();
    return {
      x: Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1),
      y: Math.min(Math.max((e.clientY - rect.top) / rect.height, 0), 1),
    };
  }

  function onDown(e: React.PointerEvent) {
    if (finalized || pending) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = norm(e);
    setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  }
  function onMove(e: React.PointerEvent) {
    if (!drag) return;
    const p = norm(e);
    setDrag({ ...drag, x1: p.x, y1: p.y });
  }
  function onUp() {
    if (!drag) return;
    const x = Math.min(drag.x0, drag.x1);
    const y = Math.min(drag.y0, drag.y1);
    const w = Math.abs(drag.x1 - drag.x0);
    const h = Math.abs(drag.y1 - drag.y0);
    setDrag(null);
    if (w < 0.005 || h < 0.005) return; // a click, not a box
    setBoxes((prev) => [...prev, { id: crypto.randomUUID(), page, x, y, w, h, reason }]);
  }

  function finalize() {
    setError(null);
    startTransition(async () => {
      const res = await finalizeVisualRedactionAction({
        agencySlug,
        requestId,
        documentId,
        boxes: boxes.map(({ page: p, x, y, w, h, reason: r }) => ({ page: p, x, y, w, h, reason: r })),
      });
      if (res.ok) {
        setConfirming(false);
        router.refresh();
      } else {
        setError(res.error);
        setConfirming(false);
      }
    });
  }

  const dragRect = drag
    ? {
        x: Math.min(drag.x0, drag.x1),
        y: Math.min(drag.y0, drag.y1),
        w: Math.abs(drag.x1 - drag.x0),
        h: Math.abs(drag.y1 - drag.y0),
      }
    : null;

  if (finalized) {
    return (
      <div className="card card-pad" style={{ maxWidth: 720 }}>
        <p style={{ margin: 0, fontWeight: 600 }}>
          ✓ Burned release copy minted — {finalized.filename}
        </p>
        <p className="muted" style={{ margin: "6px 0 12px", fontSize: "0.92rem" }}>
          {finalized.redactionCount} region(s) burned across {finalized.pageCount} page(s) on{" "}
          {finalized.atLabel}. The release copy is an image-only PDF — the covered pixels were
          destroyed, not hidden, and it carries no text layer.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <a className="btn btn-sm btn-primary" href={finalized.artifactUrl}>
            View burned PDF
          </a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 300px", gap: 16, alignItems: "start" }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
          <strong style={{ fontSize: "0.95rem" }}>{documentName}</strong>
          {pageCount > 1 && (
            <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
              <button className="btn btn-sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
                ←
              </button>
              <span className="muted" style={{ fontSize: "0.85rem" }}>
                Page {page + 1} of {pageCount}
              </span>
              <button className="btn btn-sm" disabled={page === pageCount - 1} onClick={() => setPage(page + 1)}>
                →
              </button>
            </span>
          )}
          <span className="muted" style={{ fontSize: "0.82rem", marginLeft: "auto" }}>
            Drag to draw a redaction box
          </span>
        </div>
        <div
          ref={surfaceRef}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          style={{
            position: "relative",
            border: "1px solid var(--border)",
            cursor: "crosshair",
            touchAction: "none",
            userSelect: "none",
            lineHeight: 0,
            background: "#fff",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- raw review-set bytes from a guarded route */}
          <img src={pageUrl} alt={`${documentName} — page ${page + 1}`} draggable={false} style={{ width: "100%", height: "auto", display: "block" }} />
          {pageBoxes.map((b) => (
            <div
              key={b.id}
              role="button"
              aria-label={`Remove redaction (${b.reason})`}
              title={`${b.reason} — click to remove`}
              onPointerDown={(e) => {
                e.stopPropagation();
                setBoxes((prev) => prev.filter((x) => x.id !== b.id));
              }}
              style={{
                position: "absolute",
                left: `${b.x * 100}%`,
                top: `${b.y * 100}%`,
                width: `${b.w * 100}%`,
                height: `${b.h * 100}%`,
                background: "rgba(0,0,0,0.82)",
                outline: "1.5px solid var(--overdue)",
                cursor: "pointer",
              }}
            />
          ))}
          {dragRect && (
            <div
              style={{
                position: "absolute",
                left: `${dragRect.x * 100}%`,
                top: `${dragRect.y * 100}%`,
                width: `${dragRect.w * 100}%`,
                height: `${dragRect.h * 100}%`,
                background: "rgba(0,0,0,0.4)",
                outline: "1.5px dashed var(--overdue)",
                pointerEvents: "none",
              }}
            />
          )}
        </div>
      </div>

      <div className="card card-pad" style={{ position: "sticky", top: 16 }}>
        <label className="lbl" htmlFor="visual-reason" style={{ display: "block" }}>
          New redactions cite
        </label>
        <select id="visual-reason" className="field" style={{ width: "100%", marginTop: 4 }} value={reason} onChange={(e) => setReason(e.target.value)}>
          {exemptions.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>

        <div className="panel-title" style={{ marginTop: 14 }}>
          Redactions · {boxes.length}
        </div>
        <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "grid", gap: 6, maxHeight: 260, overflowY: "auto" }}>
          {boxes.map((b, i) => (
            <li key={b.id} style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: "0.82rem" }}>
              <button
                className="btn btn-sm btn-ghost"
                style={{ padding: "0 6px" }}
                aria-label={`Remove redaction ${i + 1}`}
                onClick={() => setBoxes((prev) => prev.filter((x) => x.id !== b.id))}
              >
                ×
              </button>
              <span style={{ flex: 1, minWidth: 0 }}>
                p.{b.page + 1} · {b.reason}
              </span>
            </li>
          ))}
          {boxes.length === 0 && (
            <li className="muted" style={{ fontSize: "0.82rem" }}>
              Drag on the page to black out a region. Click a box to remove it.
            </li>
          )}
        </ul>

        {error && (
          <p style={{ color: "var(--overdue)", fontSize: "0.85rem", marginTop: 10 }}>{error}</p>
        )}

        {!confirming ? (
          <button
            className="btn btn-sm btn-primary"
            style={{ marginTop: 12, width: "100%" }}
            disabled={boxes.length === 0 || pending}
            onClick={() => setConfirming(true)}
          >
            Finalize {boxes.length > 0 ? `${boxes.length} redaction${boxes.length === 1 ? "" : "s"}` : ""}…
          </button>
        ) : (
          <div style={{ marginTop: 12 }}>
            <p style={{ fontSize: "0.85rem", margin: "0 0 8px" }}>
              Burn {boxes.length} region{boxes.length === 1 ? "" : "s"} under your name? The covered
              pixels are destroyed in the release copy.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-sm btn-primary" disabled={pending} onClick={finalize}>
                {pending ? "Burning…" : "Burn & mint release copy"}
              </button>
              <button className="btn btn-sm btn-ghost" disabled={pending} onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
