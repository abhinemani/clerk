"use client";

/**
 * Records CSV/ZIP import (docs/records-ingestion.md §1): a CSV inventory,
 * optionally accompanied by a ZIP whose members match the CSV's filenames.
 * Preview and import run the same server-side parser; every imported record
 * lands INTERNAL in the publication queue — the panel says so, because that's
 * the product's promise.
 */
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  previewRecordsImportAction,
  runRecordsImportAction,
  type RecordsPreview,
} from "../[agency]/app/(secure)/admin/records-import/actions";

const TEMPLATE = [
  "external_id,title,summary,date,record_type,tags,keywords,filename",
  'AGENDA-2026-14,"City Council agenda, June 2, 2026","Regular session agenda with staff reports",2026-06-02,agenda,"council; agenda","council meeting agenda june",agenda-2026-06-02.pdf',
  ',"Paving schedule, summer 2026","Planned street resurfacing by neighborhood",2026-05-20,schedule,"public works","paving streets resurfacing",',
].join("\n");

type Result =
  | { kind: "preview"; data: RecordsPreview }
  | { kind: "imported"; imported: number; updated: number; withFiles: number; failedCount: number; missingFiles: string[]; skippedInvalid: number }
  | { kind: "error"; message: string };

export function RecordsImportPanel({ agencySlug }: { agencySlug: string }) {
  const [csv, setCsv] = useState("");
  const [zipName, setZipName] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [pending, startTransition] = useTransition();
  const csvFileRef = useRef<HTMLInputElement>(null);
  const zipFileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function downloadTemplate() {
    const blob = new Blob([TEMPLATE], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "holmes-records-import-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function onCsvFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setCsv(String(reader.result ?? ""));
      setResult(null);
    };
    reader.readAsText(file);
  }

  function buildFormData(): FormData {
    const fd = new FormData();
    fd.set("csv", csv);
    const zip = zipFileRef.current?.files?.[0];
    if (zip) fd.set("zip", zip);
    return fd;
  }

  function preview() {
    setResult(null);
    startTransition(async () => {
      const res = await previewRecordsImportAction(agencySlug, buildFormData());
      setResult(res.ok ? { kind: "preview", data: res } : { kind: "error", message: res.error });
    });
  }

  function confirmImport() {
    startTransition(async () => {
      const res = await runRecordsImportAction(agencySlug, buildFormData());
      if (res.ok) {
        setResult({
          kind: "imported",
          imported: res.imported,
          updated: res.updated,
          withFiles: res.withFiles,
          failedCount: res.failed.length,
          missingFiles: res.missingFiles,
          skippedInvalid: res.skippedInvalid,
        });
        router.refresh();
      } else {
        setResult({ kind: "error", message: res.error });
      }
    });
  }

  return (
    <div className="card card-pad">
      <p className="muted" style={{ fontSize: "0.9rem", margin: 0, maxWidth: 640 }}>
        Bring records in from your existing systems: a CSV inventory (agendas, minutes, contracts,
        schedules), optionally with a ZIP of the files themselves — <span className="mono">filename</span>{" "}
        cells match ZIP members. Everything lands <strong>internal</strong>; nothing becomes public
        until someone on your staff publishes it from the records queue.
      </p>

      <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
        <button className="btn btn-sm" onClick={downloadTemplate} type="button">
          Download CSV template
        </button>
        <button className="btn btn-sm" onClick={() => csvFileRef.current?.click()} type="button">
          Upload a CSV file
        </button>
        <input ref={csvFileRef} type="file" accept=".csv,text/csv" onChange={onCsvFile} style={{ display: "none" }} />
        <button className="btn btn-sm" onClick={() => zipFileRef.current?.click()} type="button">
          {zipName ? `ZIP: ${zipName}` : "Attach a ZIP of files (optional)"}
        </button>
        <input
          ref={zipFileRef}
          type="file"
          accept=".zip,application/zip"
          onChange={(e) => {
            setZipName(e.target.files?.[0]?.name ?? null);
            setResult(null);
          }}
          style={{ display: "none" }}
        />
      </div>

      <textarea
        className="field mono"
        style={{ marginTop: 12, width: "100%", minHeight: 140, fontSize: "0.82rem" }}
        placeholder="Paste CSV text here, or upload a file above…"
        value={csv}
        onChange={(e) => {
          setCsv(e.target.value);
          setResult(null);
        }}
      />

      <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
        <button className="btn btn-sm btn-primary" disabled={!csv.trim() || pending} onClick={preview}>
          {pending ? "Checking…" : "Preview"}
        </button>
      </div>

      {result?.kind === "error" && (
        <p style={{ color: "var(--overdue)", fontSize: "0.9rem", marginTop: 12 }}>{result.message}</p>
      )}

      {result?.kind === "preview" && (
        <div style={{ marginTop: 16 }}>
          {result.data.missingHeaders.length > 0 ? (
            <p style={{ color: "var(--overdue)", fontSize: "0.9rem" }}>
              Missing required column(s): {result.data.missingHeaders.join(", ")}. Check the template
              above.
            </p>
          ) : (
            <>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: "0.9rem" }}>
                <span>
                  <strong>{result.data.validCount}</strong> of {result.data.totalRows} rows ready
                </span>
                {result.data.errors.length > 0 && (
                  <span style={{ color: "var(--overdue)" }}>{result.data.errors.length} row(s) will be skipped</span>
                )}
                {result.data.warningCount > 0 && (
                  <span className="muted">{result.data.warningCount} row(s) have a minor warning</span>
                )}
                {result.data.zip && (
                  <span className="muted">
                    ZIP: {result.data.zip.matchedRows} row(s) matched across {result.data.zip.memberCount}{" "}
                    member(s)
                  </span>
                )}
              </div>

              {result.data.zip && result.data.zip.unmatchedCsvFiles.length > 0 && (
                <p className="muted" style={{ fontSize: "0.82rem", marginTop: 8 }}>
                  Not found in the ZIP (these rows import metadata-only):{" "}
                  {result.data.zip.unmatchedCsvFiles.join(", ")}
                </p>
              )}

              {result.data.sample.length > 0 && (
                <table className="queue" style={{ marginTop: 10, fontSize: "0.85rem" }}>
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Title</th>
                      <th>Type</th>
                      <th>Date</th>
                      <th>File</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.data.sample.map((r) => (
                      <tr key={r.rowNumber}>
                        <td>{r.rowNumber}</td>
                        <td>{r.title.slice(0, 60)}</td>
                        <td>{r.recordType ?? "—"}</td>
                        <td>{r.date ?? "—"}</td>
                        <td className="mono" style={{ fontSize: "0.78rem" }}>{r.filename ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {result.data.errors.length > 0 && (
                <ul style={{ marginTop: 10, fontSize: "0.82rem", color: "var(--overdue)" }}>
                  {result.data.errors.map((e) => (
                    <li key={e.rowNumber}>
                      Row {e.rowNumber}: {e.reason}
                    </li>
                  ))}
                </ul>
              )}

              {result.data.validCount > 0 && (
                <button className="btn btn-sm btn-primary" style={{ marginTop: 12 }} disabled={pending} onClick={confirmImport}>
                  {pending
                    ? "Importing…"
                    : `Import ${result.data.validCount} record${result.data.validCount === 1 ? "" : "s"} (as internal)`}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {result?.kind === "imported" && (
        <div className="card" style={{ marginTop: 16, padding: 14 }}>
          <strong>
            {result.imported} record{result.imported === 1 ? "" : "s"} imported
            {result.updated > 0 ? ` (${result.updated} updated in place)` : ""}
            {result.withFiles > 0 ? `, ${result.withFiles} with files` : ""}.
          </strong>
          {result.failedCount > 0 && (
            <p style={{ color: "var(--overdue)", fontSize: "0.85rem", margin: "4px 0 0" }}>
              {result.failedCount} row(s) failed (virus scan or storage) — see the audit log.
            </p>
          )}
          {result.missingFiles.length > 0 && (
            <p className="muted" style={{ fontSize: "0.85rem", margin: "4px 0 0" }}>
              Imported metadata-only (no ZIP match): {result.missingFiles.join(", ")}
            </p>
          )}
          {result.skippedInvalid > 0 && (
            <p className="muted" style={{ fontSize: "0.85rem", margin: "4px 0 0" }}>
              {result.skippedInvalid} row(s) were skipped at preview (validation).
            </p>
          )}
          <p className="muted" style={{ fontSize: "0.85rem", marginTop: 8 }}>
            Everything is in the{" "}
            <a href={`/${agencySlug}/app/records`} style={{ fontWeight: 600 }}>
              records queue
            </a>{" "}
            as internal — publish from there when you&apos;re ready.
          </p>
        </div>
      )}
    </div>
  );
}
