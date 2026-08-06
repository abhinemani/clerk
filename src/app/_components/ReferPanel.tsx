"use client";

/**
 * "These records aren't ours" — refer the request to the agency that holds
 * them. Closing as referred (not denied) is the whole point: the requester
 * gets a real next step instead of a dead end, and the agency's denial rate
 * stays honest.
 */
import { useState, useTransition } from "react";
import { branding } from "@/config/branding";
import {
  forwardRequestAction,
  referRequestAction,
} from "../[agency]/app/(secure)/requests/[id]/actions";
import { AiPill } from "./ui";

export interface ReferTargetVM {
  id: string;
  name: string;
  jurisdictionType: string;
  contactEmail: string | null;
  recordTypes: string[];
  /** True when this entry is linked to another tenant on this deployment —
      Refer becomes Refer & forward (phase 3). */
  peerLinked?: boolean;
}

/** Phase-2 custodian suggestion — an AI draft the panel renders as a card. */
export interface CustodianProposalVM {
  directoryEntryId: string;
  name: string;
  confidence: number;
  rationale: string;
}

export function ReferPanel({
  agencySlug,
  requestId,
  targets,
  referredTo,
  referredAtLabel,
  forwardedTo,
  aiProposal,
}: {
  agencySlug: string;
  requestId: string;
  targets: ReferTargetVM[];
  /** Set when this request has already been referred. */
  referredTo?: { name: string; contactEmail: string | null; portalUrl: string | null } | null;
  referredAtLabel?: string | null;
  /** Set when the referral was a phase-3 forward — where the request lives now. */
  forwardedTo?: { agencyName: string; publicId: string; trackPath: string } | null;
  /** AI custodian suggestion, if the intake pass produced one. Never acts alone. */
  aiProposal?: CustodianProposalVM | null;
}) {
  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState("");
  const [note, setNote] = useState("");
  const [notifyTarget, setNotifyTarget] = useState(false);
  const [shareContact, setShareContact] = useState(false); // consent — default OFF
  const [proposalDismissed, setProposalDismissed] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (forwardedTo) {
    return (
      <div className="card card-pad">
        <div className="panel-title">Forwarded</div>
        <p style={{ fontSize: "0.92rem", margin: "8px 0 0" }}>
          Re-filed with <strong>{forwardedTo.agencyName}</strong>
          {referredAtLabel ? ` on ${referredAtLabel}` : ""} as{" "}
          <span className="mono">{forwardedTo.publicId}</span>. The requester keeps one thread —
          their tracker links straight to it.
        </p>
        <a className="btn btn-sm" style={{ marginTop: 10 }} href={forwardedTo.trackPath}>
          View their tracker →
        </a>
      </div>
    );
  }

  if (referredTo) {
    return (
      <div className="card card-pad">
        <div className="panel-title">Referred</div>
        <p style={{ fontSize: "0.92rem", margin: "8px 0 0" }}>
          Sent to <strong>{referredTo.name}</strong>
          {referredAtLabel ? ` on ${referredAtLabel}` : ""}. The requester has their contact details
          and their original request text.
        </p>
        {(referredTo.contactEmail || referredTo.portalUrl) && (
          <p className="muted" style={{ fontSize: "0.82rem", marginTop: 6 }}>
            {referredTo.contactEmail ?? referredTo.portalUrl}
          </p>
        )}
      </div>
    );
  }

  if (targets.length === 0) {
    return (
      <div className="card card-pad">
        <div className="panel-title">Refer elsewhere</div>
        <p className="muted" style={{ fontSize: "0.88rem", margin: "8px 0 0" }}>
          No agencies in your referral directory yet. An admin can add them under Manage staff →
          Referral directory.
        </p>
      </div>
    );
  }

  const selected = targets.find((t) => t.id === targetId);
  const proposal =
    aiProposal && !proposalDismissed && targets.some((t) => t.id === aiProposal.directoryEntryId)
      ? aiProposal
      : null;

  return (
    <div className="card card-pad">
      <div className="panel-title">Refer elsewhere</div>
      {!open ? (
        proposal ? (
          // AI proposes; the coordinator disposes. Accepting only pre-fills the
          // form — the Refer button below stays the single human act.
          <div className="ai-card" style={{ marginTop: 10 }}>
            <div className="ai-head">
              <AiPill>Custodian</AiPill>
              <span className="muted" style={{ fontSize: "0.78rem", marginLeft: "auto" }}>
                confidence {Math.round(proposal.confidence * 100)}%
              </span>
            </div>
            <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>
              These records may belong to {proposal.name}
            </div>
            <div className="muted" style={{ fontSize: "0.82rem", marginTop: 6 }}>
              {proposal.rationale}
            </div>
            <div className="ai-actions">
              <button
                className="btn btn-sm btn-primary"
                onClick={() => {
                  setTargetId(proposal.directoryEntryId);
                  setNote(proposal.rationale);
                  setOpen(true);
                }}
              >
                Review & refer…
              </button>
              <button
                className="btn btn-sm"
                onClick={() => {
                  setTargetId("");
                  setNote("");
                  setOpen(true);
                }}
              >
                Refer elsewhere…
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => setProposalDismissed(true)}>
                Dismiss
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="muted" style={{ fontSize: "0.88rem", margin: "8px 0 0" }}>
              If another agency holds these records, point the requester there instead of denying.
            </p>
            <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => setOpen(true)}>
              Refer this request…
            </button>
          </>
        )
      ) : (
        <>
          <label style={{ display: "grid", gap: 4, marginTop: 10 }}>
            <span className="lbl">Which agency holds them?</span>
            <select className="field" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
              <option value="">Choose an agency…</option>
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.peerLinked ? ` ⚡ on ${branding.productName}` : ""}
                  {t.recordTypes.length > 0 ? ` — ${t.recordTypes.slice(0, 3).join(", ")}` : ""}
                </option>
              ))}
            </select>
          </label>

          {selected?.peerLinked && (
            <div className="card" style={{ marginTop: 10, padding: "10px 12px", borderLeft: "3px solid var(--accent)", fontSize: "0.85rem" }}>
              <strong>{selected.name} is on this {branding.productName} deployment.</strong> Referring will re-file
              the request with them directly — same text, new tracking number, nothing for the
              requester to rewrite.
            </div>
          )}

          <label style={{ display: "grid", gap: 4, marginTop: 10 }}>
            <span className="lbl">Note to the requester (optional)</span>
            <input
              className="field"
              value={note}
              placeholder="Student discipline files are held by the district, not the city."
              onChange={(e) => setNote(e.target.value)}
            />
          </label>

          {selected?.peerLinked ? (
            // Consent (owner decision 2026-08-04): contact details cross the
            // tenant line only when a human checks this, per forward.
            <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 10, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={shareContact}
                onChange={(e) => setShareContact(e.target.checked)}
                style={{ marginTop: 3 }}
              />
              <span style={{ fontSize: "0.88rem" }}>
                Also send the requester&apos;s contact details so {selected.name} can reply directly
                <span className="muted" style={{ display: "block", fontSize: "0.8rem" }}>
                  Off = only the request text is forwarded; the new request is anonymous there.
                </span>
              </span>
            </label>
          ) : (
            selected?.contactEmail && (
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 10, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={notifyTarget}
                  onChange={(e) => setNotifyTarget(e.target.checked)}
                  style={{ marginTop: 3 }}
                />
                <span style={{ fontSize: "0.88rem" }}>
                  Also email {selected.name} a heads-up
                  <span className="muted" style={{ display: "block", fontSize: "0.8rem" }}>
                    Sends only what the requester already wrote.
                  </span>
                </span>
              </label>
            )
          )}

          {error && <p style={{ color: "var(--overdue)", fontSize: "0.85rem", marginTop: 8 }}>{error}</p>}

          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button
              className="btn btn-sm btn-primary"
              disabled={!targetId || pending}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  const res = selected?.peerLinked
                    ? await forwardRequestAction({
                        agencySlug,
                        requestId,
                        directoryEntryId: targetId,
                        note,
                        shareContact,
                      })
                    : await referRequestAction({
                        agencySlug,
                        requestId,
                        directoryEntryId: targetId,
                        note,
                        notifyTargetAgency: notifyTarget,
                      });
                  if (!res.ok) setError(res.error);
                });
              }}
            >
              {pending
                ? selected?.peerLinked
                  ? "Forwarding…"
                  : "Referring…"
                : selected?.peerLinked
                  ? "Refer & forward request"
                  : "Refer & notify requester"}
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </button>
          </div>
          <p className="muted" style={{ fontSize: "0.78rem", marginTop: 8 }}>
            Closes this request as <strong>referred</strong> — recorded separately from denials.
          </p>
        </>
      )}
    </div>
  );
}
