"use client";

/**
 * Connected data sources (docs/connected-sources.md phase 1): register a
 * file-drop source, sync it now, pause/resume the nightly pull, delete the
 * registration. Reviewed mode throughout — everything a sync lands waits in
 * the records queue for a named human.
 */
import { useState, useTransition } from "react";
import {
  deleteConnectedSourceAction,
  registerConnectedSourceAction,
  setConnectedSourcePausedAction,
  syncConnectedSourceNowAction,
} from "../[agency]/app/(secure)/admin/sources/actions";

export interface ConnectedSourceRow {
  id: string;
  name: string;
  paused: boolean;
  syncState: string;
  lastSyncAt: string | null;
  datasetCount: number;
  sliceCount: number;
}

export function ConnectedSourcesPanel({
  agencySlug,
  sources,
  dropDir,
}: {
  agencySlug: string;
  sources: ConnectedSourceRow[];
  dropDir: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string } | { ok: true }>, doneNote?: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError((res as { error?: string }).error ?? "Something went wrong.");
      else if (doneNote) setNotice(doneNote);
    });
  }

  return (
    <div>
      {error && (
        <p role="alert" style={{ color: "var(--overdue)", fontSize: "0.9rem", marginBottom: 10 }}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" style={{ color: "var(--ok)", fontSize: "0.9rem", marginBottom: 10 }}>
          {notice}
        </p>
      )}

      {sources.length > 0 && (
        <div className="card" style={{ overflow: "hidden", marginBottom: 18 }}>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {sources.map((s) => (
              <li key={s.id} style={{ padding: "13px 16px", borderBottom: "1px solid var(--border)" }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 600, fontSize: "0.92rem" }}>{s.name}</span>
                  <span className="tag">file drop</span>
                  <span className={`pill ${s.paused ? "" : "pill-ai"}`}>{s.paused ? "paused" : "nightly"}</span>
                  <span className="muted" style={{ fontSize: "0.82rem" }}>
                    {s.syncState}
                    {s.lastSyncAt ? ` · last ${s.lastSyncAt}` : ""}
                    {s.sliceCount > 0 ? ` · ${s.sliceCount} slice(s) across ${s.datasetCount} dataset(s)` : ""}
                  </span>
                  <span style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      className="btn btn-sm"
                      disabled={pending}
                      onClick={() =>
                        run(async () => {
                          const res = await syncConnectedSourceNowAction(agencySlug, s.id);
                          if (res.ok) {
                            const r = res.result;
                            setNotice(
                              `Synced "${s.name}": ${r.created} new for review, ${r.updated} updated, ${r.unchanged} unchanged` +
                                (r.refused.length ? `, ${r.refused.length} refused` : ""),
                            );
                          }
                          return res;
                        })
                      }
                    >
                      Sync now
                    </button>
                    <button
                      className="btn btn-sm"
                      disabled={pending}
                      onClick={() =>
                        run(
                          () => setConnectedSourcePausedAction(agencySlug, { sourceId: s.id, paused: !s.paused }),
                          s.paused ? "Nightly sync resumed." : "Sync paused — existing records are untouched.",
                        )
                      }
                    >
                      {s.paused ? "Resume" : "Pause"}
                    </button>
                    {confirmDelete === s.id ? (
                      <>
                        <button
                          className="btn btn-sm btn-danger"
                          disabled={pending}
                          onClick={() =>
                            run(
                              () => deleteConnectedSourceAction(agencySlug, s.id),
                              "Source deleted. Already-synced records stay in the corpus.",
                            )
                          }
                        >
                          Really delete
                        </button>
                        <button className="btn btn-sm" onClick={() => setConfirmDelete(null)}>
                          Keep
                        </button>
                      </>
                    ) : (
                      <button className="btn btn-sm" disabled={pending} onClick={() => setConfirmDelete(s.id)}>
                        Delete
                      </button>
                    )}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card" style={{ padding: 16 }}>
        <h3 style={{ fontSize: "0.98rem", margin: 0 }}>Connect a data source</h3>
        <p className="muted" style={{ fontSize: "0.88rem", margin: "6px 0 12px", maxWidth: 560 }}>
          Point any system that can export CSVs at the drop directory below — one file per dataset
          per period, named <code>dataset.period.csv</code> (e.g.{" "}
          <code>street-sweeping.2026-06.csv</code>). Each nightly sync lands new or changed slices
          in the records queue for review; nothing becomes public without a named decision.
        </p>
        <p style={{ fontSize: "0.85rem", margin: "0 0 12px" }}>
          Drop directory: <code>{dropDir}</code>
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = name.trim();
            if (!trimmed) return;
            run(async () => {
              const res = await registerConnectedSourceAction(agencySlug, trimmed);
              if (res.ok) {
                setName("");
                setNotice(`Source registered. Drop CSV files into ${res.dropDir} and press Sync now.`);
              }
              return res;
            });
          }}
          style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
        >
          <input
            className="field"
            style={{ flex: "1 1 240px" }}
            placeholder='Source name, e.g. "City open data portal"'
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Source name"
          />
          <button className="btn btn-primary btn-sm" disabled={pending || !name.trim()} type="submit">
            Register source
          </button>
        </form>
      </div>
    </div>
  );
}
