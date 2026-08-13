"use client";

/**
 * Ad-hoc file upload — no CSV, no spreadsheet: drag files in (or pick them)
 * and they land internal in the records queue, titled from their filenames,
 * auto-classified once the job runs. For the office with a folder to
 * digitize rather than a spreadsheet to prepare; the CSV+ZIP panel below
 * this one is for when metadata (dates, tags, record types) matters at
 * import time.
 */
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { quickUploadAction } from "../[agency]/app/(secure)/admin/records-import/actions";

type Result =
  | { kind: "done"; imported: number; failed: { rowNumber: number; reason: string }[] }
  | { kind: "error"; message: string };

const MAX_FILES = 40;

export function QuickUploadPanel({ agencySlug }: { agencySlug: string }) {
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function addFiles(list: FileList | File[]) {
    const incoming = Array.from(list);
    setResult(null);
    setFiles((prev) => [...prev, ...incoming].slice(0, MAX_FILES));
  }

  function removeFile(i: number) {
    setFiles((prev) => prev.filter((_, idx) => idx !== i));
  }

  function upload() {
    if (files.length === 0) return;
    const fd = new FormData();
    for (const f of files) fd.append("files", f);
    startTransition(async () => {
      const res = await quickUploadAction(agencySlug, fd);
      if (res.ok) {
        setResult({ kind: "done", imported: res.imported, failed: res.failed });
        setFiles([]);
        router.refresh();
      } else {
        setResult({ kind: "error", message: res.error });
      }
    });
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
        }}
        className="card"
        style={{
          padding: "28px 20px",
          textAlign: "center",
          cursor: "pointer",
          borderStyle: "dashed",
          borderWidth: 2,
          borderColor: dragOver ? "var(--primary)" : "var(--border)",
          background: dragOver ? "var(--primary-tint)" : undefined,
        }}
      >
        <p style={{ margin: 0, fontWeight: 600 }}>Drop files here, or click to choose</p>
        <p className="muted" style={{ margin: "6px 0 0", fontSize: "0.85rem" }}>
          Any mix of PDFs, images, DOCX, or text — up to {MAX_FILES} at a time, 25 MB total. No
          spreadsheet needed; titles come from filenames and the record type gets suggested once
          it lands.
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          onChange={(e) => e.target.files && addFiles(e.target.files)}
          style={{ display: "none" }}
        />
      </div>

      {files.length > 0 && (
        <div className="card" style={{ marginTop: 12, overflow: "hidden" }}>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {files.map((f, i) => (
              <li
                key={`${f.name}-${i}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 14px",
                  borderBottom: "1px solid var(--border)",
                  fontSize: "0.88rem",
                }}
              >
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {f.name}
                </span>
                <span className="muted" style={{ fontSize: "0.78rem" }}>
                  {(f.size / 1024).toFixed(0)} KB
                </span>
                <button
                  className="btn btn-sm btn-ghost"
                  type="button"
                  onClick={() => removeFile(i)}
                  aria-label={`Remove ${f.name}`}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <div style={{ padding: "10px 14px" }}>
            <button className="btn btn-primary btn-sm" disabled={pending} onClick={upload}>
              {pending ? "Uploading…" : `Upload ${files.length} file${files.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      )}

      {result?.kind === "done" && (
        <p role="status" className="muted" style={{ fontSize: "0.88rem", marginTop: 10 }}>
          {result.imported} file{result.imported === 1 ? "" : "s"} uploaded — internal, waiting in the
          records queue.
          {result.failed.length > 0 && ` ${result.failed.length} failed: ${result.failed.map((f) => f.reason).join("; ")}`}
        </p>
      )}
      {result?.kind === "error" && (
        <p style={{ color: "var(--overdue)", fontSize: "0.88rem", marginTop: 10 }}>{result.message}</p>
      )}
    </div>
  );
}
