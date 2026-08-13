"use client";

/**
 * Legacy CSV import (roadmap Tier 1): paste or upload an export from
 * NextRequest/GovQA/a spreadsheet, preview what will happen, then commit.
 * Preview and import both run the exact same server-side parser — nothing
 * is re-implemented client-side, so the preview is never a lie.
 */
import { useRef, useState, useTransition } from "react";
import {
  previewLegacyImportAction,
  runLegacyImportAction,
  type PreviewResult,
} from "../[agency]/app/(secure)/admin/import/actions";

const TEMPLATE = [
  "legacy_id,requester_name,requester_email,description,status,filed_date,due_date,closed_date,department,record_type",
  '"OLD-2024-0091",Jane Reyes,jane@example.com,"All emails re: Main St paving, Jan-Mar 2024",fulfilled,2024-01-15,2024-01-25,2024-01-24,Public Works,contract',
].join("\n");

type Result =
  | { kind: "preview"; data: PreviewResult }
  | { kind: "imported"; imported: number; failedCount: number; skippedInvalid: number }
  | { kind: "error"; message: string };

export function LegacyImportPanel({ agencySlug }: { agencySlug: string }) {
  const [csv, setCsv] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  function downloadTemplate() {
    const blob = new Blob([TEMPLATE], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "holmes-legacy-import-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCsv(String(reader.result ?? ""));
    reader.readAsText(file);
  }

  function preview() {
    setResult(null);
    startTransition(async () => {
      const res = await previewLegacyImportAction(agencySlug, csv);
      setResult(res.ok ? { kind: "preview", data: res } : { kind: "error", message: res.error });
    });
  }

  function confirmImport() {
    startTransition(async () => {
      const res = await runLegacyImportAction(agencySlug, csv);
      setResult(
        res.ok
          ? { kind: "imported", imported: res.imported.length, failedCount: res.failed.length, skippedInvalid: res.skippedInvalid }
          : { kind: "error", message: res.error },
      );
    });
  }

  return (
    <div className="card card-pad">
      <p className="muted" style={{ fontSize: "0.9rem", margin: 0, maxWidth: 640 }}>
        Bring in requests from a spreadsheet or your old system (NextRequest, GovQA, anything that
        exports CSV). Each row becomes a real, searchable request with its original status and
        dates — audited as an import, not pretended to be filed today.
      </p>

      <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
        <button className="btn btn-sm" onClick={downloadTemplate} type="button">
          Download CSV template
        </button>
        <button className="btn btn-sm" onClick={() => fileRef.current?.click()} type="button">
          Upload a CSV file
        </button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} style={{ display: "none" }} />
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
              Missing required column(s): {result.data.missingHeaders.join(", ")}. Every row failed —
              check the template above.
            </p>
          ) : (
            <>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: "0.9rem" }}>
                <span>
                  <strong>{result.data.validCount}</strong> of {result.data.totalRows} rows ready to
                  import
                </span>
                {result.data.errors.length > 0 && (
                  <span style={{ color: "var(--overdue)" }}>{result.data.errors.length} row(s) will be skipped</span>
                )}
                {result.data.warningCount > 0 && (
                  <span className="muted">{result.data.warningCount} row(s) have a minor warning</span>
                )}
              </div>

              {result.data.sample.length > 0 && (
                <table className="queue" style={{ marginTop: 10, fontSize: "0.85rem" }}>
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Description</th>
                      <th>Status</th>
                      <th>Filed</th>
                      <th>Requester</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.data.sample.map((r) => (
                      <tr key={r.rowNumber}>
                        <td>{r.rowNumber}</td>
                        <td>{r.description.slice(0, 60)}</td>
                        <td>{r.status}</td>
                        <td>{new Date(r.receivedAt).toLocaleDateString()}</td>
                        <td>{r.requesterName ?? "—"}</td>
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
                  {pending ? "Importing…" : `Import ${result.data.validCount} request${result.data.validCount === 1 ? "" : "s"}`}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {result?.kind === "imported" && (
        <div className="card" style={{ marginTop: 16, padding: 14 }}>
          <strong>
            {result.imported} request{result.imported === 1 ? "" : "s"} imported.
          </strong>
          {result.skippedInvalid > 0 && (
            <p className="muted" style={{ fontSize: "0.85rem", margin: "4px 0 0" }}>
              {result.skippedInvalid} row(s) were skipped at preview (validation).
            </p>
          )}
          {result.failedCount > 0 && (
            <p style={{ color: "var(--overdue)", fontSize: "0.85rem", margin: "4px 0 0" }}>
              {result.failedCount} row(s) failed during import — see server logs.
            </p>
          )}
          <p className="muted" style={{ fontSize: "0.85rem", marginTop: 8 }}>
            Imported requests are in the queue now, tagged with an audit note naming you as the
            importer.
          </p>
        </div>
      )}
    </div>
  );
}
