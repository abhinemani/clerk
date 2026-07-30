"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { dateShort } from "@/lib/format";
import { isPublicId } from "@/domain/publicId";
import {
  replyToRequestAction,
  trackRequest,
  type ThreadMessage,
  type TrackResult,
} from "../[agency]/actions";

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

export function RequestTracker({
  agencySlug,
  initialId = "",
}: {
  agencySlug: string;
  initialId?: string;
}) {
  const [q, setQ] = useState(initialId);
  const [result, setResult] = useState<TrackResult | null>(null);
  const [searchedFor, setSearchedFor] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function lookup(id: string) {
    const trimmed = id.trim();
    if (!trimmed) return;
    startTransition(async () => {
      const r = await trackRequest(agencySlug, trimmed);
      setResult(r);
      setSearchedFor(trimmed);
    });
  }

  // Deep link (?id=…) from the filing confirmation: look it up on arrival.
  useEffect(() => {
    if (initialId) lookup(initialId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const trimmed = q.trim();
  // A malformed number never left the demo era; a well-formed unknown one gets
  // a friendly generic state instead of "not found".
  const validButUnknown = result && !result.found && isPublicId((searchedFor ?? "").toUpperCase());

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          lookup(q);
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
            setResult(null);
          }}
          aria-label="Request tracking number"
        />
        <button className="btn btn-primary" type="submit" style={{ paddingInline: 22 }} disabled={pending || !trimmed}>
          {pending ? "Checking…" : "Track"}
        </button>
      </form>

      {result && searchedFor && (
        <div className="card" style={{ marginTop: 14, overflow: "hidden" }}>
          {result.found ? (
            <TrackerResult
              agencySlug={agencySlug}
              publicId={result.publicId}
              status={result.status}
              received={new Date(result.receivedAtISO)}
              due={new Date(result.dueAtISO)}
              daysLeft={result.daysLeft}
              artifacts={result.artifacts}
              extension={result.extension}
              timeline={result.timeline}
              thread={result.thread}
              onReplied={() => lookup(result.publicId)}
            />
          ) : validButUnknown ? (
            <div style={{ padding: "18px 20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="mono muted">{searchedFor.toUpperCase()}</span>
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
  agencySlug,
  publicId,
  status,
  received,
  due,
  daysLeft,
  artifacts = [],
  extension,
  timeline = [],
  thread,
  onReplied,
}: {
  agencySlug: string;
  publicId: string;
  status: string;
  received: Date;
  due: Date;
  daysLeft: number;
  artifacts?: { filename: string; url: string }[];
  extension?: { days: number; reason: string; atISO: string } | null;
  timeline?: { label: string; atISO: string }[];
  thread?: { requestId: string; messages: ThreadMessage[] };
  onReplied: () => void;
}) {
  const s = RESIDENT_STATUS[status] ?? { headline: status, detail: "", tone: "wait" as const };
  const band = s.tone === "ok" ? "band-on_track" : s.tone === "action" ? "band-due_soon" : "pill";
  const released = artifacts.length > 0;

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
        {released && (
          <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
            {artifacts.map((a) => (
              <a
                key={a.url}
                href={a.url}
                className="btn btn-sm"
                style={{ justifyContent: "flex-start", gap: 10 }}
                download
              >
                ⬇ <span className="mono" style={{ fontSize: "0.85rem" }}>{a.filename}</span>
              </a>
            ))}
          </div>
        )}
        {extension && (
          <div
            className="card"
            style={{ marginTop: 14, padding: "10px 14px", borderLeft: "3px solid var(--due)", fontSize: "0.92rem" }}
          >
            <strong>Deadline extended {extension.days} days</strong> on {dateShort(new Date(extension.atISO))}{" "}
            — reason given: {extension.reason.replace(/_/g, " ")}. The date below already includes it.
          </div>
        )}
        <div style={{ display: "flex", gap: 20, marginTop: 16, flexWrap: "wrap" }}>
          <div>
            <div className="muted" style={{ fontSize: "0.78rem" }}>
              Filed
            </div>
            <div style={{ fontWeight: 600 }}>{dateShort(received)}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: "0.78rem" }}>
              {released ? "Completed" : "Expected by"}
            </div>
            <div style={{ fontWeight: 600 }}>
              {dateShort(due)}{" "}
              {!released && (
                <span className="muted" style={{ fontWeight: 400 }}>
                  {daysLeft >= 0 ? `(${daysLeft} day${daysLeft === 1 ? "" : "s"} left)` : "(processing)"}
                </span>
              )}
            </div>
          </div>
        </div>
        {timeline.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <div className="muted" style={{ fontSize: "0.78rem", marginBottom: 6 }}>
              Progress so far
            </div>
            <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
              {timeline.map((t, i) => (
                <li key={i} style={{ display: "flex", gap: 10, alignItems: "baseline", fontSize: "0.9rem" }}>
                  <span aria-hidden style={{ color: "var(--accent)" }}>•</span>
                  <span style={{ flex: 1 }}>{t.label}</span>
                  <span className="muted" style={{ fontSize: "0.78rem" }}>{dateShort(new Date(t.atISO))}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
        {thread ? (
          <MessageThread
            agencySlug={agencySlug}
            requestId={thread.requestId}
            messages={thread.messages}
            needsReply={status === "clarification_needed"}
            onReplied={onReplied}
          />
        ) : (
          <p className="muted" style={{ fontSize: "0.85rem", marginTop: 18, marginBottom: 0 }}>
            Filed with an email address?{" "}
            <Link href={`/${agencySlug}/login`} style={{ textDecoration: "underline" }}>
              Sign in
            </Link>{" "}
            to see messages from the records office and reply.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The correspondence thread + reply box — rendered only when the server
 * confirmed the viewer owns this request (the thread never travels on the
 * tracking number alone).
 */
function MessageThread({
  agencySlug,
  requestId,
  messages,
  needsReply,
  onReplied,
}: {
  agencySlug: string;
  requestId: string;
  messages: ThreadMessage[];
  needsReply: boolean;
  onReplied: () => void;
}) {
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, startSending] = useTransition();

  function send() {
    setError(null);
    startSending(async () => {
      const result = await replyToRequestAction({ agencySlug, requestId, body: reply });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setReply("");
      onReplied(); // re-fetch so the reply (and any status change) appears
    });
  }

  return (
    <div style={{ marginTop: 20, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
      <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>
        Messages{" "}
        <span className="muted" style={{ fontWeight: 400, fontSize: "0.82rem" }}>
          · between you and the records office
        </span>
      </div>

      {messages.length === 0 ? (
        <p className="muted" style={{ fontSize: "0.88rem", marginTop: 10 }}>
          No messages yet. If we have a question about your request, it shows up here.
        </p>
      ) : (
        <ol style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "grid", gap: 8 }}>
          {messages.map((m) => (
            <li
              key={m.id}
              style={{
                border: "1px solid var(--border)",
                borderRadius: "var(--r-sm)",
                padding: "10px 12px",
                background: m.direction === "inbound" ? "var(--surface-2)" : "var(--surface)",
              }}
            >
              <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                <strong style={{ fontSize: "0.82rem" }}>
                  {m.direction === "inbound" ? "You" : "Records office"}
                </strong>
                <span className="muted" style={{ fontSize: "0.75rem", marginLeft: "auto" }}>
                  {dateShort(new Date(m.atISO))}
                </span>
              </div>
              {m.subject && (
                <div style={{ fontWeight: 600, fontSize: "0.86rem", marginTop: 3 }}>{m.subject}</div>
              )}
              <p style={{ fontSize: "0.88rem", marginTop: 3, marginBottom: 0, whiteSpace: "pre-wrap" }}>
                {m.body}
              </p>
            </li>
          ))}
        </ol>
      )}

      {needsReply && (
        <p className="pill band-due_soon" style={{ marginTop: 12 }}>
          The records office is waiting on your answer — replying restarts work on your request.
        </p>
      )}

      {error && (
        <p className="pill band-overdue" role="alert" style={{ marginTop: 10 }}>
          {error}
        </p>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "flex-start" }}>
        <textarea
          className="field"
          style={{ flex: 1, minHeight: 64, resize: "vertical" }}
          placeholder="Write a reply…"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          aria-label="Reply to the records office"
        />
        <button
          className="btn btn-primary"
          disabled={sending || !reply.trim()}
          onClick={send}
          style={{ paddingInline: 18 }}
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}
