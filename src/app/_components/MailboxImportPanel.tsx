"use client";

/**
 * Mailbox import (fulfillment): a coordinator uploads what IT hands them —
 * an mbox export, one .eml, or a ZIP of .eml files — against THIS request.
 * Preview parses server-side with the exact parser the import uses; confirm
 * explodes every message and attachment into the review set.
 */
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  previewMailboxImportAction,
  runMailboxImportAction,
  type MailboxPreview,
} from "../[agency]/app/(secure)/requests/[id]/actions";

type Result =
  | { kind: "preview"; data: MailboxPreview }
  | { kind: "imported"; messages: number; attachments: number; refused: string[]; unparseable: number; duplicates: number }
  | { kind: "error"; message: string };

export function MailboxImportPanel({ agencySlug, requestId }: { agencySlug: string; requestId: string }) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function formData(): FormData | null {
    const file = fileRef.current?.files?.[0];
    if (!file) return null;
    const fd = new FormData();
    fd.set("mailbox", file);
    return fd;
  }

  function preview() {
    const fd = formData();
    if (!fd) return;
    setResult(null);
    startTransition(async () => {
      const res = await previewMailboxImportAction({ agencySlug, requestId }, fd);
      setResult(res.ok ? { kind: "preview", data: res } : { kind: "error", message: res.error });
    });
  }

  function confirmImport() {
    const fd = formData();
    if (!fd) return;
    startTransition(async () => {
      const res = await runMailboxImportAction({ agencySlug, requestId }, fd);
      if (res.ok) {
        setResult({ kind: "imported", ...res });
        router.refresh();
      } else {
        setResult({ kind: "error", message: res.error });
      }
    });
  }

  return (
    <div className="card card-pad">
      <div className="panel-title">Import a mailbox export</div>
      <p className="muted" style={{ fontSize: "0.88rem", margin: "6px 0 12px", maxWidth: 560 }}>
        When responsive records are emails, upload the custodian&apos;s export (.mbox, .eml, or a
        ZIP of .eml files). Every message and attachment becomes a reviewable document on this
        request — searchable, virus-scanned, and redactable like any other upload.
      </p>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn btn-sm" type="button" onClick={() => fileRef.current?.click()}>
          Choose mailbox file
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".mbox,.eml,.zip,message/rfc822"
          style={{ display: "none" }}
          onChange={(e) => {
            setFileName(e.target.files?.[0]?.name ?? null);
            setResult(null);
          }}
        />
        {fileName && <span className="mono" style={{ fontSize: "0.82rem" }}>{fileName}</span>}
        <button className="btn btn-sm btn-primary" disabled={!fileName || pending} onClick={preview}>
          {pending && result === null ? "Reading…" : "Preview"}
        </button>
      </div>

      {result?.kind === "error" && (
        <p style={{ color: "var(--overdue)", fontSize: "0.88rem", marginTop: 10 }}>{result.message}</p>
      )}

      {result?.kind === "preview" && (
        <div style={{ marginTop: 12 }}>
          <p style={{ fontSize: "0.9rem", margin: 0 }}>
            <strong>{result.data.messages}</strong> message{result.data.messages === 1 ? "" : "s"}
            {result.data.attachments > 0 && <> · {result.data.attachments} attachment{result.data.attachments === 1 ? "" : "s"}</>}
            {result.data.dateRange && (
              <span className="muted"> · {result.data.dateRange.from} → {result.data.dateRange.to}</span>
            )}
            {result.data.unparseable > 0 && (
              <span style={{ color: "var(--overdue)" }}> · {result.data.unparseable} unreadable</span>
            )}
          </p>
          <ul className="muted" style={{ fontSize: "0.82rem", margin: "8px 0 0", paddingLeft: 18 }}>
            {result.data.sampleSubjects.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
          <button className="btn btn-sm btn-primary" style={{ marginTop: 12 }} disabled={pending} onClick={confirmImport}>
            {pending ? "Importing…" : `Import ${result.data.messages} message${result.data.messages === 1 ? "" : "s"} into the review set`}
          </button>
        </div>
      )}

      {result?.kind === "imported" && (
        <div style={{ marginTop: 12 }}>
          <p style={{ fontSize: "0.9rem", margin: 0, fontWeight: 600 }}>
            ✓ {result.messages} message{result.messages === 1 ? "" : "s"} and {result.attachments}{" "}
            attachment{result.attachments === 1 ? "" : "s"} added to the review set.
            {result.duplicates > 0 && (
              <span className="muted" style={{ fontWeight: 400 }}>
                {" "}
                {result.duplicates} already on this request — skipped, not re-imported.
              </span>
            )}
          </p>
          {result.refused.length > 0 && (
            <ul style={{ color: "var(--overdue)", fontSize: "0.82rem", margin: "8px 0 0", paddingLeft: 18 }}>
              {result.refused.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}
          <p className="muted" style={{ fontSize: "0.82rem", marginTop: 8 }}>
            The import is audited under your name. Exemption suggestions and search indexing run in
            the background.
          </p>
        </div>
      )}
    </div>
  );
}
