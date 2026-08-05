"use client";

/**
 * "These records aren't ours" — refer the request to the agency that holds
 * them. Closing as referred (not denied) is the whole point: the requester
 * gets a real next step instead of a dead end, and the agency's denial rate
 * stays honest.
 */
import { useState, useTransition } from "react";
import { referRequestAction } from "../[agency]/app/(secure)/requests/[id]/actions";

export interface ReferTargetVM {
  id: string;
  name: string;
  jurisdictionType: string;
  contactEmail: string | null;
  recordTypes: string[];
}

export function ReferPanel({
  agencySlug,
  requestId,
  targets,
  referredTo,
  referredAtLabel,
}: {
  agencySlug: string;
  requestId: string;
  targets: ReferTargetVM[];
  /** Set when this request has already been referred. */
  referredTo?: { name: string; contactEmail: string | null; portalUrl: string | null } | null;
  referredAtLabel?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState("");
  const [note, setNote] = useState("");
  const [notifyTarget, setNotifyTarget] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="card card-pad">
      <div className="panel-title">Refer elsewhere</div>
      {!open ? (
        <>
          <p className="muted" style={{ fontSize: "0.88rem", margin: "8px 0 0" }}>
            If another agency holds these records, point the requester there instead of denying.
          </p>
          <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => setOpen(true)}>
            Refer this request…
          </button>
        </>
      ) : (
        <>
          <label style={{ display: "grid", gap: 4, marginTop: 10 }}>
            <span className="lbl">Which agency holds them?</span>
            <select className="field" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
              <option value="">Choose an agency…</option>
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.recordTypes.length > 0 ? ` — ${t.recordTypes.slice(0, 3).join(", ")}` : ""}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: "grid", gap: 4, marginTop: 10 }}>
            <span className="lbl">Note to the requester (optional)</span>
            <input
              className="field"
              value={note}
              placeholder="Student discipline files are held by the district, not the city."
              onChange={(e) => setNote(e.target.value)}
            />
          </label>

          {selected?.contactEmail && (
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
          )}

          {error && <p style={{ color: "var(--overdue)", fontSize: "0.85rem", marginTop: 8 }}>{error}</p>}

          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button
              className="btn btn-sm btn-primary"
              disabled={!targetId || pending}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  const res = await referRequestAction({
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
              {pending ? "Referring…" : "Refer & notify requester"}
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
