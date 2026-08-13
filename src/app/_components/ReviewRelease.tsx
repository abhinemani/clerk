"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { threadMessages } from "@/domain/emailThread";
import {
  denyRequestAction,
  draftDenialAction,
  releaseRequestAction,
  reviewDocumentAction,
} from "../[agency]/app/(secure)/requests/[id]/actions";

export interface ReviewDocVM {
  documentId: string;
  filename: string;
  pages: number | null;
  /** Real stored bytes exist → filename links to the download endpoint. */
  hasBlob: boolean;
  decision: "release" | "release_redacted" | "withhold" | null;
  exemptionLabel: string | null;
  /** §6.5 auto-classification suggestions (advisory only). */
  aiRecordType?: string | null;
  aiSensitivityNote?: string | null;
  /** Present on mailbox-imported messages — threads them in the panel. */
  email?: {
    messageId: string | null;
    inReplyTo: string | null;
    references: string[];
    subject: string | null;
    from: string | null;
    dateIso: string | null;
  };
  /** Present on mailbox-imported attachments: the message doc they rode in on. */
  attachmentOfDocumentId?: string | null;
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
export interface ExemptionOptionVM {
  citation: string;
  label: string;
}

export function ReviewRelease({
  agencySlug,
  requestId,
  docs: initialDocs,
  release,
  denied = false,
  exemptionOptions = [],
}: {
  agencySlug: string;
  requestId: string;
  docs: ReviewDocVM[];
  release: ReleaseVM | null;
  /** The request already ended in a formal denial. */
  denied?: boolean;
  /** The agency's statute exemption catalog (§7) — feeds the denial citations. */
  exemptionOptions?: ExemptionOptionVM[];
}) {
  const router = useRouter();
  const [docs, setDocs] = useState(initialDocs);
  const [exemptions, setExemptions] = useState<Record<string, string>>(
    Object.fromEntries(initialDocs.map((d) => [d.documentId, d.exemptionLabel ?? ""])),
  );
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [letter, setLetter] = useState("");
  const [citations, setCitations] = useState<string[]>([]);
  const [explanation, setExplanation] = useState("");
  const [letterBody, setLetterBody] = useState("");
  const [letterAiMeta, setLetterAiMeta] = useState<{ promptVersion: string; model: string } | undefined>();
  const [letterWarnings, setLetterWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [drafting, startDrafting] = useTransition();

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

  if (denied) {
    return (
      <div className="card card-pad">
        <div className="panel-title">Determination</div>
        <div className="pill band-overdue" style={{ marginTop: 10 }}>
          Request formally denied
        </div>
        <p className="muted" style={{ fontSize: "0.85rem", marginTop: 10 }}>
          The denial letter — with its exemption citations and appeal rights — is in the
          correspondence thread above and the outbox.
        </p>
      </div>
    );
  }

  const undecided = docs.filter((d) => !d.decision).length;
  const allWithheld = undecided === 0 && docs.length > 0 && docs.every((d) => d.decision === "withhold");

  // No review set at all: the panel's only lawful move is the no-records
  // determination — a reasonable search found nothing.
  if (docs.length === 0) {
    return (
      <div className="card card-pad stack" style={{ gap: 12 }}>
        <div className="panel-title">Determination</div>
        <p className="muted" style={{ fontSize: "0.9rem", margin: 0 }}>
          No documents are in the review set. If the departments&apos; search located no responsive
          records, close the request with a formal no-records determination — the letter includes
          the statute&apos;s appeal language.
        </p>
        {error && (
          <p className="pill band-overdue" role="alert" style={{ justifySelf: "start" }}>
            {error}
          </p>
        )}
        <textarea
          className="field"
          rows={2}
          placeholder="Search description for the letter (optional), e.g. which systems were searched"
          value={explanation}
          onChange={(e) => setExplanation(e.target.value)}
        />
        <div>
          <button
            className="btn btn-primary"
            disabled={pending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const r = await denyRequestAction({
                  agencySlug,
                  requestId,
                  exemptions: [],
                  noRecords: true,
                  explanation: explanation.trim() || undefined,
                });
                if (!r.ok) {
                  setError(r.error);
                  return;
                }
                router.refresh();
              });
            }}
          >
            {pending ? "One moment…" : "Close as no responsive records — as yourself"}
          </button>
          <p className="muted" style={{ fontSize: "0.78rem", marginTop: 8 }}>
            Your name goes on the determination; the letter lands in the requester&apos;s thread and
            the outbox, and the clock stops.
          </p>
        </div>
      </div>
    );
  }

  function deny() {
    setError(null);
    const chosen = exemptionOptions.filter((o) => citations.includes(o.citation));
    if (chosen.length === 0) {
      setError("Select at least one exemption citation for the denial.");
      return;
    }
    startTransition(async () => {
      const r = await denyRequestAction({
        agencySlug,
        requestId,
        exemptions: chosen,
        explanation: explanation.trim() || undefined,
        letterBody: letterBody.trim() || undefined,
        letterAiMeta: letterBody.trim() ? letterAiMeta : undefined,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  function draftLetter() {
    setError(null);
    const chosen = exemptionOptions.filter((o) => citations.includes(o.citation));
    startDrafting(async () => {
      const r = await draftDenialAction({
        agencySlug,
        requestId,
        exemptions: chosen,
        explanation: explanation.trim() || undefined,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setLetterBody(r.body);
      setLetterAiMeta(r.aiMeta);
      setLetterWarnings(r.warnings);
    });
  }

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

  function approve(acceptResidualRisk = false) {
    setError(null);
    startTransition(async () => {
      const r = await releaseRequestAction({
        agencySlug,
        requestId,
        visibility,
        responseLetter: letter.trim() || undefined,
        acceptResidualRisk,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  // The §6.5 pre-release PII refusal — overridable only explicitly.
  const residualRefusal = error?.includes("Possible PII in document") ?? false;

  // Mailbox-imported messages render as conversation threads; their
  // attachments nest under the message they rode in on. Everything else
  // renders flat, exactly as before. Every row keeps its own decision —
  // threading changes reading order, never review granularity.
  const docById = new Map(docs.map((d) => [d.documentId, d]));
  const attachmentsByMessage = new Map<string, ReviewDocVM[]>();
  for (const d of docs) {
    const parent = d.attachmentOfDocumentId;
    if (parent && docById.get(parent)?.email) {
      const list = attachmentsByMessage.get(parent) ?? [];
      list.push(d);
      attachmentsByMessage.set(parent, list);
    }
  }
  const emailDocs = docs.filter((d) => d.email);
  const nested = new Set([
    ...emailDocs.map((d) => d.documentId),
    ...[...attachmentsByMessage.values()].flat().map((d) => d.documentId),
  ]);
  const flatDocs = docs.filter((d) => !nested.has(d.documentId));
  const threads = threadMessages(
    emailDocs.map((d) => ({ documentId: d.documentId, ...d.email! })),
  );

  function docRow(d: ReviewDocVM, opts: { indent?: boolean } = {}) {
    return (
      <li
        key={d.documentId}
        style={{
          border: "1px solid var(--border)",
          borderRadius: "var(--r-sm)",
          padding: "10px 12px",
          display: "grid",
          gap: 8,
          ...(opts.indent ? { marginLeft: 22 } : {}),
        }}
      >
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span className="mono" style={{ fontSize: "0.85rem", flex: 1, minWidth: 160 }}>
            {opts.indent && <span className="muted" title="Email attachment">↳ </span>}
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
        {d.email && (d.email.from || d.email.dateIso) && (
          <div className="muted" style={{ fontSize: "0.78rem" }}>
            {d.email.from ?? "Unknown sender"}
            {d.email.dateIso ? ` · ${d.email.dateIso}` : ""}
          </div>
        )}
        {(d.aiRecordType || d.aiSensitivityNote) && (
          <div className="muted" style={{ fontSize: "0.78rem", display: "flex", gap: 8, flexWrap: "wrap" }}>
            {d.aiRecordType && <span className="tag">{d.aiRecordType}</span>}
            {d.aiSensitivityNote && <span>⚠ {d.aiSensitivityNote}</span>}
          </div>
        )}
        <input
          className="field"
          style={{ paddingBlock: 7, fontSize: "0.85rem" }}
          placeholder="Exemption reason (required unless releasing in full), e.g. Personnel privacy"
          value={exemptions[d.documentId] ?? ""}
          onChange={(e) => setExemptions((p) => ({ ...p, [d.documentId]: e.target.value }))}
        />
      </li>
    );
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
        {flatDocs.map((d) => docRow(d))}
        {threads.map((t) => (
          <li
            key={`thread-${t.messages[0]!.documentId}`}
            style={{
              border: "1px solid var(--border)",
              borderRadius: "var(--r-sm)",
              padding: "10px 12px",
              display: "grid",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
              <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>✉ {t.subject}</span>
              <span className="muted" style={{ fontSize: "0.78rem" }}>
                {t.messages.length} message{t.messages.length === 1 ? "" : "s"}
                {t.messages.reduce((n, m) => n + (attachmentsByMessage.get(m.documentId)?.length ?? 0), 0) > 0 &&
                  ` · ${t.messages.reduce((n, m) => n + (attachmentsByMessage.get(m.documentId)?.length ?? 0), 0)} attachment(s)`}
              </span>
            </div>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
              {t.messages.map((m) => {
                const d = docById.get(m.documentId);
                if (!d) return null;
                return (
                  <Fragment key={d.documentId}>
                    {docRow(d)}
                    {(attachmentsByMessage.get(d.documentId) ?? []).map((a) => docRow(a, { indent: true }))}
                  </Fragment>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>

      <hr className="divider" />

      {allWithheld ? (
        <div className="stack" style={{ gap: 12 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>Formal denial</div>
            <p className="muted" style={{ fontSize: "0.85rem", marginTop: 4 }}>
              Every record is withheld — issue an exemption-cited denial with the statute&apos;s
              appeal language instead of an empty release.
            </p>
          </div>
          {exemptionOptions.length > 0 ? (
            <div style={{ display: "grid", gap: 6 }}>
              {exemptionOptions.map((o) => (
                <label key={o.citation} style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: "0.88rem" }}>
                  <input
                    type="checkbox"
                    checked={citations.includes(o.citation)}
                    onChange={(e) =>
                      setCitations((prev) =>
                        e.target.checked ? [...prev, o.citation] : prev.filter((c) => c !== o.citation),
                      )
                    }
                  />
                  <span>
                    <span className="mono" style={{ fontSize: "0.82rem" }}>{o.citation}</span>
                    <span className="muted"> — {o.label}</span>
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <p className="pill band-due_soon" style={{ fontSize: "0.82rem" }}>
              No statute profile configured — the denial needs citations from counsel.
            </p>
          )}
          <textarea
            className="field"
            rows={2}
            placeholder="Explanation for the letter (optional), e.g. why the exemption applies"
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
          />
          {letterBody ? (
            <div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span className="lbl">Denial letter</span>
                <span className="muted" style={{ fontSize: "0.78rem" }}>
                  {letterAiMeta ? "AI-drafted — edit before denying" : "composed from the statute profile"}
                </span>
              </div>
              <textarea
                className="field"
                rows={10}
                style={{ marginTop: 6, fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}
                value={letterBody}
                onChange={(e) => setLetterBody(e.target.value)}
                aria-label="Denial letter body"
              />
              {letterWarnings.map((w) => (
                <div key={w} className="pill band-due_soon" style={{ marginTop: 6, display: "inline-flex" }}>
                  ⚠ {w}
                </div>
              ))}
            </div>
          ) : (
            <div>
              <button
                className="btn btn-sm btn-ghost"
                disabled={drafting || citations.length === 0}
                onClick={draftLetter}
              >
                {drafting ? "Drafting…" : "✦ Draft the letter"}
              </button>
              <span className="muted" style={{ fontSize: "0.78rem", marginLeft: 8 }}>
                Optional — without a draft, the standard composed letter is sent.
              </span>
            </div>
          )}
          <div>
            <button
              className="btn btn-primary"
              disabled={pending || citations.length === 0}
              onClick={deny}
            >
              {pending ? "One moment…" : "Deny request as yourself"}
            </button>
            <p className="muted" style={{ fontSize: "0.78rem", marginTop: 8 }}>
              Your name goes on the denial. The letter cites the selected exemptions, includes the
              appeal language verbatim, stops the clock, and lands in the requester&apos;s thread.
            </p>
          </div>
        </div>
      ) : (
      <>
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
        <button className="btn btn-primary" disabled={pending || undecided > 0} onClick={() => approve()}>
          {pending ? "One moment…" : "Approve release as yourself"}
        </button>
        {residualRefusal && (
          <button
            className="btn btn-sm"
            style={{ marginLeft: 8 }}
            disabled={pending}
            onClick={() => approve(true)}
          >
            Accept flagged risk &amp; release anyway
          </button>
        )}
        <p className="muted" style={{ fontSize: "0.78rem", marginTop: 8 }}>
          Your name goes on this release — nothing reaches the requester without a named approver.
        </p>
      </div>
      </>
      )}
    </div>
  );
}
