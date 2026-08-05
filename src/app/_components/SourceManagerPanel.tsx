"use client";

/**
 * Source trust management (docs/records-ingestion.md §4): each connected
 * source's trust posture — review queue (safe default) vs auto-publish (a
 * feed the office already vets) — plus ingest-key rotation for API sources.
 * A rotated key shows exactly once, same rule as provisioning.
 */
import { useState, useTransition } from "react";
import {
  rotateSourceKeyAction,
  updateSourcePolicyAction,
} from "../[agency]/app/(secure)/admin/records-import/actions";

export interface SourceRow {
  id: string;
  name: string;
  type: string;
  hasKey: boolean;
  trust: "auto_publish" | "review_queue";
  defaultClassification: "public" | "internal";
}

const TYPE_LABELS: Record<string, string> = {
  api_push: "Ingestion API",
  file_drop: "CSV / file drop",
  webhook: "Webhook",
  scheduled_pull: "Scheduled pull",
  manual: "Manual",
};

export function SourceManagerPanel({ agencySlug, sources }: { agencySlug: string; sources: SourceRow[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rotated, setRotated] = useState<{ sourceId: string; key: string } | null>(null);
  const [confirmRotate, setConfirmRotate] = useState<string | null>(null);

  function savePolicy(sourceId: string, trust: SourceRow["trust"], defaultClassification: SourceRow["defaultClassification"]) {
    setError(null);
    startTransition(async () => {
      const res = await updateSourcePolicyAction({ agencySlug, sourceId, trust, defaultClassification });
      if (!res.ok) setError(res.error);
    });
  }

  function rotate(sourceId: string) {
    setError(null);
    setConfirmRotate(null);
    startTransition(async () => {
      const res = await rotateSourceKeyAction({ agencySlug, sourceId });
      if (res.ok) setRotated({ sourceId, key: res.ingestKey });
      else setError(res.error);
    });
  }

  if (sources.length === 0) {
    return (
      <p className="muted" style={{ fontSize: "0.9rem" }}>
        No sources yet — the first CSV import creates a file-drop source automatically.
      </p>
    );
  }

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {sources.map((s) => (
          <li key={s.id} style={{ padding: "13px 16px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontWeight: 600, fontSize: "0.92rem" }}>{s.name}</span>
              <span className="tag">{TYPE_LABELS[s.type] ?? s.type}</span>
              <span className={`pill ${s.trust === "auto_publish" ? "pill-ai" : ""}`}>
                {s.trust === "auto_publish" ? "auto-publish" : "review queue"}
              </span>
              <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <label className="muted" style={{ fontSize: "0.8rem" }}>
                  Incoming records:{" "}
                  <select
                    className="field"
                    style={{ fontSize: "0.82rem", padding: "3px 6px" }}
                    disabled={pending}
                    value={`${s.trust}|${s.defaultClassification}`}
                    onChange={(e) => {
                      const [trust, cls] = e.target.value.split("|") as [SourceRow["trust"], SourceRow["defaultClassification"]];
                      savePolicy(s.id, trust, cls);
                    }}
                  >
                    <option value="review_queue|internal">held for review (recommended)</option>
                    <option value="auto_publish|public">published automatically</option>
                    <option value="auto_publish|internal">accepted as internal</option>
                    {/* Legacy combo some sources carry; shown only when active. */}
                    {s.trust === "review_queue" && s.defaultClassification === "public" && (
                      <option value="review_queue|public">held for review (public once accepted)</option>
                    )}
                  </select>
                </label>
                {s.hasKey &&
                  (confirmRotate === s.id ? (
                    <span style={{ display: "inline-flex", gap: 6 }}>
                      <button className="btn btn-sm btn-primary" disabled={pending} onClick={() => rotate(s.id)}>
                        Yes, rotate — old key stops working
                      </button>
                      <button className="btn btn-sm btn-ghost" onClick={() => setConfirmRotate(null)}>
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button className="btn btn-sm" disabled={pending} onClick={() => setConfirmRotate(s.id)}>
                      Rotate key
                    </button>
                  ))}
              </span>
            </div>
            {s.trust === "auto_publish" && s.defaultClassification === "public" && (
              <p className="muted" style={{ fontSize: "0.78rem", margin: "6px 0 0" }}>
                Records from this source skip the queue and publish straight to the archive — use only
                for a feed your office already vets (agendas, minutes).
              </p>
            )}
            {rotated?.sourceId === s.id && (
              <div className="card" style={{ marginTop: 8, padding: 10, background: "var(--paper-2)" }}>
                <p style={{ fontSize: "0.85rem", margin: 0 }}>
                  New ingest key — copy it now; it will not be shown again:
                </p>
                <code className="mono" style={{ fontSize: "0.85rem", wordBreak: "break-all", userSelect: "all" }}>
                  {rotated.key}
                </code>
              </div>
            )}
          </li>
        ))}
      </ul>
      {error && (
        <p style={{ color: "var(--overdue)", fontSize: "0.85rem", padding: "10px 16px", margin: 0 }}>{error}</p>
      )}
    </div>
  );
}
