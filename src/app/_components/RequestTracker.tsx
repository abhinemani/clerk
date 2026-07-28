"use client";

import { useState } from "react";
import { DEMO_NOW, DEMO_REQUESTS } from "@/lib/demo";
import { dateShort } from "@/lib/format";
import { isPublicId } from "@/domain/publicId";

/** Plain-language, resident-facing status (no jargon). */
const RESIDENT_STATUS: Record<string, { headline: string; detail: string; tone: "ok" | "wait" | "action" }> = {
  submitted: { headline: "Received", detail: "We have your request and will begin shortly.", tone: "wait" },
  in_review: { headline: "Under review", detail: "We're confirming what you're asking for.", tone: "wait" },
  clarification_needed: {
    headline: "We need a little more info",
    detail: "Check your messages — a quick reply will speed things up.",
    tone: "action",
  },
  in_progress: { headline: "Gathering your records", detail: "We're collecting records from the right departments.", tone: "wait" },
  records_review: { headline: "Almost ready", detail: "We're reviewing the records before releasing them.", tone: "wait" },
  partially_fulfilled: { headline: "Some records released", detail: "Part is ready to download; more is on the way.", tone: "ok" },
  fulfilled: { headline: "Your records are ready", detail: "Download them below.", tone: "ok" },
  denied: { headline: "Request denied", detail: "See the reason and your appeal rights in your messages.", tone: "action" },
  closed: { headline: "Closed", detail: "This request is complete.", tone: "ok" },
};

const MS_DAY = 86_400_000;

export function RequestTracker({ initialId = "" }: { initialId?: string }) {
  const [q, setQ] = useState(initialId);
  const [searched, setSearched] = useState(Boolean(initialId));

  const trimmed = q.trim();
  const match = DEMO_REQUESTS.find((r) => r.publicId.toLowerCase() === trimmed.toLowerCase());
  // A freshly-filed request isn't in the demo set — show a friendly generic state
  // for any well-formed tracking number instead of "not found".
  const validButUnknown = !match && isPublicId(trimmed.toUpperCase());

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSearched(true);
        }}
        style={{ display: "flex", gap: 10, flexWrap: "wrap" }}
      >
        <input
          className="field"
          style={{ flex: 1, minWidth: 220, fontSize: "1.02rem", paddingBlock: 14 }}
          placeholder="Your tracking number, e.g. PR-2026-00341"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSearched(false);
          }}
          aria-label="Request tracking number"
        />
        <button className="btn btn-primary" type="submit" style={{ paddingInline: 22 }}>
          Track
        </button>
      </form>

      {searched && trimmed && (
        <div className="card" style={{ marginTop: 14, overflow: "hidden" }}>
          {match ? (
            <TrackerResult publicId={match.publicId} status={match.status} received={match.receivedAt} due={match.dueAt} />
          ) : validButUnknown ? (
            <div style={{ padding: "18px 20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="mono muted">{trimmed.toUpperCase()}</span>
                <span className="pill" style={{ marginLeft: "auto" }}>
                  Received
                </span>
              </div>
              <p style={{ marginTop: 10 }}>
                We have your request and it&apos;s in the queue for review. You&apos;ll see updates here
                as it moves through the departments.
              </p>
            </div>
          ) : (
            <div style={{ padding: 20 }}>
              <div style={{ fontWeight: 600 }}>We couldn&apos;t find that tracking number.</div>
              <p className="muted" style={{ fontSize: "0.92rem", marginTop: 4 }}>
                Double-check it (it looks like <span className="mono">PR-2026-00341</span>), or the
                confirmation email we sent when you filed.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TrackerResult({
  publicId,
  status,
  received,
  due,
}: {
  publicId: string;
  status: string;
  received: Date;
  due: Date;
}) {
  const s = RESIDENT_STATUS[status] ?? { headline: status, detail: "", tone: "wait" as const };
  const daysLeft = Math.round((due.getTime() - DEMO_NOW.getTime()) / MS_DAY);
  const band = s.tone === "ok" ? "band-on_track" : s.tone === "action" ? "band-due_soon" : "pill";

  return (
    <div>
      <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
        <span className="mono muted">{publicId}</span>
        <span className={`pill ${band}`} style={{ marginLeft: "auto" }}>
          {s.headline}
        </span>
      </div>
      <div style={{ padding: "18px 20px" }}>
        <p style={{ fontSize: "1.02rem" }}>{s.detail}</p>
        <div style={{ display: "flex", gap: 20, marginTop: 16, flexWrap: "wrap" }}>
          <div>
            <div className="muted" style={{ fontSize: "0.78rem" }}>
              Filed
            </div>
            <div style={{ fontWeight: 600 }}>{dateShort(received)}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: "0.78rem" }}>
              Expected by
            </div>
            <div style={{ fontWeight: 600 }}>
              {dateShort(due)}{" "}
              <span className="muted" style={{ fontWeight: 400 }}>
                {daysLeft >= 0 ? `(${daysLeft} day${daysLeft === 1 ? "" : "s"} left)` : "(processing)"}
              </span>
            </div>
          </div>
        </div>
        <button className="btn btn-sm" style={{ marginTop: 18 }}>
          Message the records office
        </button>
      </div>
    </div>
  );
}
