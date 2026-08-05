"use client";

/**
 * The publication decision surface (docs/records-ingestion.md §2). Each row is
 * one piped-in record; "Publish" (with an editable archive-metadata form
 * prefilled from the import) or "Keep internal" are the two decisions. Bulk
 * select exists for volume, but the server loops per document so every
 * decision is individually audited under the signed-in staff member's name.
 * AI hints render as hints — the buttons are the only act.
 */
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  keepInternalRecordsAction,
  publishRecordsAction,
  type PerDocResult,
} from "../[agency]/app/(secure)/records/actions";
import { AiPill } from "./ui";

export interface QueueDocVM {
  id: string;
  title: string;
  filename: string | null;
  sourceName: string;
  dateLabel: string | null;
  recordType: string | null;
  summary: string;
  tags: string[];
  keywords: string[];
  preview: string | null;
  hasFile: boolean;
  ai: {
    suggestedClassification: "public" | "internal";
    recordType: string;
    sensitivityNote: string | null;
  } | null;
  decision: { decision: string; byName: string; at: string } | null;
}

type Mode = "undecided" | "published" | "internal";

export function PublicationQueue({
  agencySlug,
  mode,
  docs,
}: {
  agencySlug: string;
  mode: Mode;
  docs: QueueDocVM[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openForm, setOpenForm] = useState<string | null>(null);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [banner, setBanner] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const decidable = mode !== "published";
  const allSelected = selected.size === docs.length && docs.length > 0;

  const byId = useMemo(() => new Map(docs.map((d) => [d.id, d])), [docs]);

  function applyResults(results: PerDocResult[], verb: string) {
    const failed = results.filter((r) => !r.ok);
    setErrors(new Map(failed.map((r) => [r.documentId, r.error ?? "Failed."])));
    const okCount = results.length - failed.length;
    setBanner(
      okCount > 0
        ? `${okCount} record${okCount === 1 ? "" : "s"} ${verb}.${failed.length ? ` ${failed.length} failed.` : ""}`
        : null,
    );
    setSelected(new Set());
    setConfirmBulk(false);
    setOpenForm(null);
    router.refresh();
  }

  function publishOne(id: string, form: { title: string; summary: string; tags: string; keywords: string }) {
    startTransition(async () => {
      const res = await publishRecordsAction(agencySlug, [{ documentId: id, ...form }]);
      if (res.ok) applyResults(res.results, "published to the archive");
      else setBanner(res.error);
    });
  }

  function publishSelected() {
    const items = [...selected].map((id) => ({ documentId: id })); // imported metadata as-is
    startTransition(async () => {
      const res = await publishRecordsAction(agencySlug, items);
      if (res.ok) applyResults(res.results, "published to the archive");
      else setBanner(res.error);
    });
  }

  function keepSelected(ids?: string[]) {
    const list = ids ?? [...selected];
    startTransition(async () => {
      const res = await keepInternalRecordsAction(agencySlug, list);
      if (res.ok) applyResults(res.results, "kept internal");
      else setBanner(res.error);
    });
  }

  if (docs.length === 0) {
    return (
      <p className="muted" style={{ marginTop: 16 }}>
        {mode === "undecided"
          ? "Nothing awaiting a decision — imported and piped-in records land here."
          : mode === "published"
            ? "Nothing published from this queue yet."
            : "No records have been explicitly kept internal yet."}
      </p>
    );
  }

  return (
    <div style={{ marginTop: 14 }}>
      {banner && (
        <p className="pill band-on_track" style={{ marginBottom: 10 }}>
          {banner}
        </p>
      )}

      {decidable && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
          <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: "0.85rem" }}>
            <input
              type="checkbox"
              checked={allSelected}
              onChange={(e) => setSelected(e.target.checked ? new Set(docs.map((d) => d.id)) : new Set())}
            />
            Select all ({docs.length})
          </label>
          {selected.size > 0 && (
            <>
              <span className="muted" style={{ fontSize: "0.85rem" }}>
                {selected.size} selected
              </span>
              {confirmBulk ? (
                <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                  <span style={{ fontSize: "0.85rem" }}>
                    Publish {selected.size} record{selected.size === 1 ? "" : "s"} to the PUBLIC archive?
                  </span>
                  <button className="btn btn-sm btn-primary" disabled={pending} onClick={publishSelected}>
                    {pending ? "Publishing…" : "Yes, publish"}
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={() => setConfirmBulk(false)}>
                    Cancel
                  </button>
                </span>
              ) : (
                <button className="btn btn-sm btn-primary" disabled={pending} onClick={() => setConfirmBulk(true)}>
                  Publish selected
                </button>
              )}
              {mode === "undecided" && (
                <button className="btn btn-sm" disabled={pending} onClick={() => keepSelected()}>
                  Keep selected internal
                </button>
              )}
            </>
          )}
        </div>
      )}

      <div className="card" style={{ overflow: "hidden" }}>
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {docs.map((d) => (
            <li key={d.id} style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                {decidable && (
                  <input
                    type="checkbox"
                    style={{ marginTop: 4 }}
                    checked={selected.has(d.id)}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(d.id);
                      else next.delete(d.id);
                      setSelected(next);
                    }}
                  />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 600, fontSize: "0.95rem" }}>{d.title}</span>
                    {d.recordType && <span className="tag">{d.recordType}</span>}
                    {d.dateLabel && (
                      <span className="muted" style={{ fontSize: "0.8rem" }}>
                        {d.dateLabel}
                      </span>
                    )}
                  </div>
                  <div className="muted" style={{ fontSize: "0.8rem", marginTop: 2 }}>
                    {d.sourceName}
                    {d.filename && (
                      <>
                        {" · "}
                        <span className="mono">{d.filename}</span>
                        {!d.hasFile && " (metadata only)"}
                      </>
                    )}
                    {!d.filename && " · metadata only"}
                  </div>
                  {d.summary && (
                    <p style={{ fontSize: "0.88rem", margin: "6px 0 0", color: "var(--ink-2)" }}>{d.summary}</p>
                  )}
                  {d.preview && (
                    <p
                      className="mono muted"
                      style={{ fontSize: "0.78rem", margin: "6px 0 0", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                    >
                      {d.preview}
                    </p>
                  )}
                  {d.ai && mode === "undecided" && (
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                      <AiPill>AI suggests</AiPill>
                      <span style={{ fontSize: "0.82rem" }}>
                        {d.ai.suggestedClassification === "public" ? "publish" : "keep internal"}
                        {d.ai.recordType ? ` · looks like ${d.ai.recordType}` : ""}
                      </span>
                      {d.ai.sensitivityNote && (
                        <span style={{ fontSize: "0.82rem", color: "var(--overdue)" }}>{d.ai.sensitivityNote}</span>
                      )}
                    </div>
                  )}
                  {d.decision && mode !== "undecided" && (
                    <p className="muted" style={{ fontSize: "0.78rem", margin: "6px 0 0" }}>
                      {d.decision.decision === "published" ? "Published" : "Kept internal"} by {d.decision.byName} ·{" "}
                      {d.decision.at}
                    </p>
                  )}
                  {errors.get(d.id) && (
                    <p style={{ color: "var(--overdue)", fontSize: "0.82rem", margin: "6px 0 0" }}>{errors.get(d.id)}</p>
                  )}

                  {openForm === d.id && (
                    <PublishForm
                      key={d.id}
                      doc={d}
                      pending={pending}
                      onCancel={() => setOpenForm(null)}
                      onPublish={(form) => publishOne(d.id, form)}
                    />
                  )}
                </div>
                {decidable && openForm !== d.id && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <button className="btn btn-sm btn-primary" disabled={pending} onClick={() => setOpenForm(d.id)}>
                      Publish…
                    </button>
                    {mode === "undecided" && (
                      <button className="btn btn-sm" disabled={pending} onClick={() => keepSelected([d.id])}>
                        Keep internal
                      </button>
                    )}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function PublishForm({
  doc,
  pending,
  onCancel,
  onPublish,
}: {
  doc: QueueDocVM;
  pending: boolean;
  onCancel: () => void;
  onPublish: (form: { title: string; summary: string; tags: string; keywords: string }) => void;
}) {
  const [title, setTitle] = useState(doc.title);
  const [summary, setSummary] = useState(doc.summary);
  const [tags, setTags] = useState(doc.tags.join(", "));
  const [keywords, setKeywords] = useState(doc.keywords.join(", "));

  return (
    <div className="card" style={{ marginTop: 10, padding: 12, background: "var(--paper-2)" }}>
      <div style={{ display: "grid", gap: 8 }}>
        <label style={{ fontSize: "0.82rem" }}>
          Archive title
          <input className="field" style={{ width: "100%" }} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label style={{ fontSize: "0.82rem" }}>
          Summary shown to residents
          <textarea
            className="field"
            style={{ width: "100%", minHeight: 56 }}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />
        </label>
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
          <label style={{ fontSize: "0.82rem" }}>
            Tags (comma-separated)
            <input className="field" style={{ width: "100%" }} value={tags} onChange={(e) => setTags(e.target.value)} />
          </label>
          <label style={{ fontSize: "0.82rem" }}>
            Search keywords
            <input
              className="field"
              style={{ width: "100%" }}
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
            />
          </label>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button
          className="btn btn-sm btn-primary"
          disabled={pending || !title.trim()}
          onClick={() => onPublish({ title, summary, tags, keywords })}
        >
          {pending ? "Publishing…" : "Publish to the public archive"}
        </button>
        <button className="btn btn-sm btn-ghost" disabled={pending} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
