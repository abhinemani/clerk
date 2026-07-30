"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { releaseRequestAction, reviewDocumentAction } from "../[agency]/app/(secure)/requests/[id]/actions";

export interface ReviewDocVM {
  documentId: string;
  filename: string;
  pages: number | null;
  /** Real stored bytes exist → filename links to the download endpoint. */
  hasBlob: boolean;
  decision: "release" | "release_redacted" | "withhold" | null;
  exemptionLabel: string | null;
}

export interface ReleaseVM {
  released: number;
  visibility: "public" | "private";
  releasedAtLabel: string;
  approverName: string;
  responseLetter: string | null;
}

const DECISIONS = [
  { value: "release", label: "Release" },
  { value: "release_redacted", label: "Release redacted" },
  { value: "withhold", label: "Withhold" },
] as const;

/**
 * The review-and-release panel (§5 Review/Release): a named human decides
 * every document, then approves the release. AI never touches this surface —
 * it is deliberately the most human part of the product.
 */
export function ReviewRelease({
  agencySlug,
  requestId,
  docs: initialDocs,
  release,
}: {
  agencySlug: string;
  requestId: string;
  docs: ReviewDocVM[];
  release: ReleaseVM | null;
}) {
  const router = useRouter();
  const [docs, setDocs] = useState(initialDocs);
  const [exemptions, setExemptions] = useState<Record<string, string>>(
    Object.fromEntries(initialDocs.map((d) => [d.documentId, d.exemptionLabel ?? ""])),
  );
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [letter, setLetter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (release) {
    return (
      <div className="card card-pad">
        <div className="panel-title">Release</div>
        <div className="pill band-on_track" style={{ marginTop: 10 }}>
          ✓ {release.released} record(s) released · {release.visibility === "public" ? "published to the archive" : "private to the requester"}
        </div>
        <p className="muted" style={{ fontSize: "0.85rem", marginTop: 10 }}>
          Approved by <strong>{release.approverName}</strong> · {release.releasedAtLabel}
        </p>
        {release.responseLetter && (
          <pre
            style={{
              marginTop: 10,
              padding: "12px 14px",
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              borderRadius: "var(--r-sm)",
              fontFamily: "var(--font-mono)",
              fontSize: "0.78rem",
              whiteSpace: "pre-wrap",
            }}
          >
            {release.responseLetter}
          </pre>
        )}
      </div>
    );
  }

  if (docs.length === 0) return null;

  const undecided = docs.filter((d) => !d.decision).length;

  function decide(documentId: string, decision: ReviewDocVM["decision"]) {
    if (!decision) return;
    setError(null);
    const exemptionLabel = exemptions[documentId]?.trim() || undefined;
    if (decision !== "release" && !exemptionLabel) {
      setError("Withholding or redacting requires an exemption reason — add one first.");
      return;
    }
    startTransition(async () => {
      const r = await reviewDocumentAction({ agencySlug, requestId, documentId, decision, exemptionLabel });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setDocs((prev) => prev.map((d) => (d.documentId === documentId ? { ...d, decision } : d)));
    });
  }

  function approve() {
    setError(null);
    startTransition(async () => {
      const r = await releaseRequestAction({
        agencySlug,
        requestId,
        visibility,
        responseLetter: letter.trim() || undefined,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="card card-pad stack" style={{ gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div className="panel-title">Review &amp; release</div>
        <span className="pill">{undecided ? `${undecided} undecided` : "ready to release"}</span>
      </div>

      {error && (
        <p className="pill band-overdue" role="alert" style={{ justifySelf: "start" }}>
          {error}
        </p>
      )}

      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
        {docs.map((d) => (
          <li
            key={d.documentId}
            style={{
              border: "1px solid var(--border)",
              borderRadius: "var(--r-sm)",
              padding: "10px 12px",
              display: "grid",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span className="mono" style={{ fontSize: "0.85rem", flex: 1, minWidth: 160 }}>
                {d.hasBlob ? (
                  <a href={`/${agencySlug}/files/${d.documentId}`} title="Download for review">
                    {d.filename}
                  </a>
                ) : (
                  d.filename
                )}
                {d.pages ? <span className="muted"> · {d.pages}p</span> : null}
              </span>
              <select
                className="field"
                style={{ width: "auto", paddingBlock: 6 }}
                value={d.decision ?? ""}
                disabled={pending}
                aria-label={`Decision for ${d.filename}`}
                onChange={(e) => decide(d.documentId, e.target.value as ReviewDocVM["decision"])}
              >
                <option value="" disabled>
                  Decide…
                </option>
                {DECISIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <input
              className="field"
              style={{ paddingBlock: 7, fontSize: "0.85rem" }}
              placeholder="Exemption reason (required unless releasing in full), e.g. Personnel privacy"
              value={exemptions[d.documentId] ?? ""}
              onChange={(e) => setExemptions((p) => ({ ...p, [d.documentId]: e.target.value }))}
            />
          </li>
        ))}
      </ul>

      <hr className="divider" />

      <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <label className="lbl" htmlFor="rel-vis">
          Archive visibility
        </label>
        <select
          id="rel-vis"
          className="field"
          style={{ width: "auto", paddingBlock: 7 }}
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as "public" | "private")}
        >
          <option value="public">Public — publish to the archive</option>
          <option value="private">Private — requester only</option>
        </select>
      </div>
      <textarea
        className="field"
        rows={3}
        placeholder="Response letter (leave blank for the standard letter)"
        value={letter}
        onChange={(e) => setLetter(e.target.value)}
      />
      <div>
        <button className="btn btn-primary" disabled={pending || undecided > 0} onClick={approve}>
          {pending ? "One moment…" : "Approve release as yourself"}
        </button>
        <p className="muted" style={{ fontSize: "0.78rem", marginTop: 8 }}>
          Your name goes on this release — nothing reaches the requester without a named approver.
        </p>
      </div>
    </div>
  );
}
