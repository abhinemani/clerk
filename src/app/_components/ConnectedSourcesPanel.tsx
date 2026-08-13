"use client";

/**
 * Connected data sources (docs/connected-sources.md): register a source
 * (file drop, HTTP export, or Socrata portal), sync it, and decide per
 * dataset whether new slices publish automatically.
 *
 * The standing-publication control is deliberately wordy: it is the one
 * button on this page that changes what residents can see without a further
 * human step, so the consequences are spelled out where the click happens
 * rather than in documentation nobody opens.
 */
import { useState, useTransition } from "react";
import {
  attestDatasetAction,
  deleteConnectedSourceAction,
  registerConnectedSourceAction,
  revokeAttestationAction,
  setConnectedSourcePausedAction,
  syncConnectedSourceNowAction,
} from "../[agency]/app/(secure)/admin/sources/actions";

export interface DatasetRow {
  dataset: string;
  slices: number;
  published: number;
  quarantined: number;
  latestPeriod: string;
  attestedBy: string | null;
  attestedAt: string | null;
}

export interface ConnectedSourceRow {
  id: string;
  name: string;
  kind: string;
  /** Where the data comes from, shown so the office can eyeball it. */
  origin: string;
  paused: boolean;
  syncState: string;
  lastSyncAt: string | null;
  datasets: DatasetRow[];
}

const KIND_LABEL: Record<string, string> = {
  dataset_file_drop: "file drop",
  dataset_http: "HTTP export",
  dataset_socrata: "Socrata portal",
};

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
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmAttest, setConfirmAttest] = useState<string | null>(null);

  // Registration form
  const [kind, setKind] = useState("dataset_file_drop");
  const [name, setName] = useState("");
  const [dataset, setDataset] = useState("");
  const [dateField, setDateField] = useState("");
  const [url, setUrl] = useState("");
  const [domain, setDomain] = useState("");
  const [datasetId, setDatasetId] = useState("");
  const [tokenEnv, setTokenEnv] = useState("");

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, doneNote?: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong.");
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

      {sources.map((s) => (
        <div key={s.id} className="card" style={{ marginBottom: 14, overflow: "hidden" }}>
          <div style={{ padding: "13px 16px", borderBottom: s.datasets.length ? "1px solid var(--border)" : undefined }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontWeight: 600, fontSize: "0.95rem" }}>{s.name}</span>
              <span className="tag">{KIND_LABEL[s.kind] ?? s.kind}</span>
              <span className={`pill ${s.paused ? "" : "pill-ai"}`}>{s.paused ? "paused" : "nightly"}</span>
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
                          `Synced "${s.name}": ${r.created} new (${r.autoPublished} auto-published), ${r.updated} updated, ${r.unchanged} unchanged` +
                            (r.quarantined.length ? `, ${r.quarantined.length} held for review` : "") +
                            (r.driftRevoked.length ? ` — standing publication revoked for ${r.driftRevoked.join(", ")} (columns changed)` : "") +
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
            <div className="muted" style={{ fontSize: "0.8rem", marginTop: 6 }}>
              <code>{s.origin}</code> · {s.syncState}
              {s.lastSyncAt ? ` · last ${s.lastSyncAt}` : ""}
            </div>
          </div>

          {s.datasets.map((d) => (
            <div key={d.dataset} style={{ padding: "11px 16px", borderTop: "1px solid var(--border)" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <strong style={{ fontSize: "0.88rem" }}>{d.dataset}</strong>
                <span className="muted" style={{ fontSize: "0.8rem" }}>
                  {d.slices} slice{d.slices === 1 ? "" : "s"} · {d.published} public · newest {d.latestPeriod}
                </span>
                {d.quarantined > 0 && (
                  <span className="pill band-due_soon" style={{ fontSize: "0.72rem" }}>
                    {d.quarantined} held for review
                  </span>
                )}
                {d.attestedBy ? (
                  <span className="pill band-on_track" style={{ fontSize: "0.72rem" }}>
                    standing publication · {d.attestedBy}
                  </span>
                ) : (
                  <span className="pill" style={{ fontSize: "0.72rem" }}>
                    reviewed
                  </span>
                )}
                <span style={{ marginLeft: "auto" }}>
                  {d.attestedBy ? (
                    <button
                      className="btn btn-sm"
                      disabled={pending}
                      onClick={() =>
                        run(
                          () => revokeAttestationAction(agencySlug, { sourceId: s.id, dataset: d.dataset }),
                          `"${d.dataset}" is back to review. Already-published slices stay public.`,
                        )
                      }
                    >
                      Turn off
                    </button>
                  ) : (
                    <button className="btn btn-sm" disabled={pending} onClick={() => setConfirmAttest(`${s.id}:${d.dataset}`)}>
                      Publish automatically…
                    </button>
                  )}
                </span>
              </div>

              {confirmAttest === `${s.id}:${d.dataset}` && (
                <div
                  className="card"
                  style={{ padding: "10px 12px", marginTop: 8, background: "var(--surface-2)" }}
                >
                  <p style={{ fontSize: "0.85rem", margin: 0 }}>
                    You are attesting that <strong>{d.dataset}</strong> is public data. From now on,
                    new periods of it are published to residents as they sync — no further review.
                    Your name is recorded on every one.
                  </p>
                  <p className="muted" style={{ fontSize: "0.8rem", margin: "6px 0 0" }}>
                    The {d.slices} slice{d.slices === 1 ? "" : "s"} already here are not affected —
                    publish those yourself in the records queue. Slices with personal information,
                    or whose columns change, are always held back for you to look at.
                  </p>
                  <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                    <button
                      className="btn btn-sm btn-primary"
                      disabled={pending}
                      onClick={() => {
                        setConfirmAttest(null);
                        run(async () => {
                          const res = await attestDatasetAction(agencySlug, { sourceId: s.id, dataset: d.dataset });
                          if (res.ok) {
                            setNotice(
                              `Standing publication ON for "${d.dataset}" — recorded under ${res.byName}. Future slices publish on sync.`,
                            );
                          }
                          return res;
                        });
                      }}
                    >
                      Yes, publish future slices
                    </button>
                    <button className="btn btn-sm btn-ghost" onClick={() => setConfirmAttest(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {s.datasets.length === 0 && (
            <div className="muted" style={{ padding: "11px 16px", fontSize: "0.83rem", borderTop: "1px solid var(--border)" }}>
              Nothing synced yet — press <strong>Sync now</strong> to pull this source.
            </div>
          )}
        </div>
      ))}

      <div className="card" style={{ padding: 16 }}>
        <h3 style={{ fontSize: "0.98rem", margin: 0 }}>Connect a data source</h3>
        <div style={{ display: "flex", gap: 6, margin: "10px 0", flexWrap: "wrap" }}>
          {Object.entries(KIND_LABEL).map(([k, label]) => (
            <button
              key={k}
              className={`btn btn-sm ${kind === k ? "btn-primary" : ""}`}
              onClick={() => setKind(k)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>

        {kind === "dataset_file_drop" && (
          <p className="muted" style={{ fontSize: "0.88rem", margin: "0 0 12px", maxWidth: 580 }}>
            Point any system that can export CSVs at this directory — one file per dataset per
            period, named <code>dataset.period.csv</code> (e.g.{" "}
            <code>street-sweeping.2026-06.csv</code>).<br />
            <code style={{ fontSize: "0.85em" }}>{dropDir}</code>
          </p>
        )}
        {kind === "dataset_http" && (
          <p className="muted" style={{ fontSize: "0.88rem", margin: "0 0 12px", maxWidth: 580 }}>
            One https URL holding the whole dataset as CSV or JSON. We split it into monthly
            records using the date column you name.
          </p>
        )}
        {kind === "dataset_socrata" && (
          <p className="muted" style={{ fontSize: "0.88rem", margin: "0 0 12px", maxWidth: 580 }}>
            An open-data portal (Socrata). Find the domain and the dataset&apos;s 4×4 id in its API
            docs — e.g. <code>data.cityofchicago.org</code> and <code>ygr5-vcbg</code>. Only the
            months that actually contain rows become records.
          </p>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = name.trim();
            if (!trimmed) return;
            run(async () => {
              const res = await registerConnectedSourceAction(agencySlug, {
                name: trimmed,
                kind,
                config: { dataset, dateField, url, domain, datasetId, tokenEnv },
              });
              if (res.ok) {
                setName("");
                setDataset("");
                setDateField("");
                setUrl("");
                setDomain("");
                setDatasetId("");
                setTokenEnv("");
                setNotice("Source registered. Press Sync now to pull it.");
              }
              return res;
            });
          }}
          style={{ display: "grid", gap: 8, maxWidth: 560 }}
        >
          <input
            className="field"
            placeholder='Source name, e.g. "City open data portal"'
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Source name"
          />
          {kind !== "dataset_file_drop" && (
            <>
              <input
                className="field"
                placeholder="Dataset name, e.g. street-sweeping"
                value={dataset}
                onChange={(e) => setDataset(e.target.value)}
                aria-label="Dataset name"
              />
              <input
                className="field"
                placeholder="Date column to slice by, e.g. sweep_date"
                value={dateField}
                onChange={(e) => setDateField(e.target.value)}
                aria-label="Date column"
              />
            </>
          )}
          {kind === "dataset_http" && (
            <input
              className="field"
              placeholder="https://data.yourcity.gov/exports/sweeping.csv"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              aria-label="Export URL"
            />
          )}
          {kind === "dataset_socrata" && (
            <>
              <input
                className="field"
                placeholder="Portal domain, e.g. data.cityofchicago.org"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                aria-label="Portal domain"
              />
              <input
                className="field"
                placeholder="Dataset id, e.g. ygr5-vcbg"
                value={datasetId}
                onChange={(e) => setDatasetId(e.target.value)}
                aria-label="Dataset id"
              />
            </>
          )}
          {kind !== "dataset_file_drop" && (
            <label className="muted" style={{ fontSize: "0.82rem" }}>
              Private feed? Name the environment variable holding its token (optional) — never
              paste the token itself.
              <input
                className="field"
                style={{ marginTop: 4 }}
                placeholder="CITY_PORTAL_TOKEN"
                value={tokenEnv}
                onChange={(e) => setTokenEnv(e.target.value)}
                aria-label="Token environment variable name"
              />
            </label>
          )}
          <div>
            <button className="btn btn-primary btn-sm" disabled={pending || !name.trim()} type="submit">
              Register source
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
