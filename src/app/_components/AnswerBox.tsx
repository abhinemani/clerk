"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import type { ArchiveItem } from "@/lib/archive";
import {
  askRecordsAgentAction,
  findPriorAnswersAction,
  logDeflectionAction,
  searchArchiveAction,
  type PriorAnswerCard,
} from "../[agency]/actions";
import { ConnectedDataTag } from "./ConnectedDataBadge";
import { SparkIcon } from "./ui";

interface AgentTurn {
  role: "user" | "assistant";
  text: string;
  items?: ArchiveItem[];
  suggestedRequest?: string | null;
  /** Why the agent replied this way — gates which affordances we render. */
  intent?: "answer" | "clarify" | "draft_request";
}

/**
 * The portal front door (§6.7): a question box, not a form. Answers from the
 * tenant's own public corpus first (deflection), and only pivots to filing a
 * request when the corpus can't help. Retrieval is hard-scoped to public
 * documents server-side; every download or scope-down is logged as a
 * Deflection — the ROI number agencies show their councils.
 */
export function AnswerBox({ agencySlug, aiEnabled = false }: { agencySlug: string; aiEnabled?: boolean }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ArchiveItem[]>([]);
  /** Set when the query named a time window — shown so the filter is visible.
   *  An invisible filter is indistinguishable from a corpus with gaps. */
  const [windowNote, setWindowNote] = useState<{ label: string; subject: string } | null>(null);
  /** Records that surfaced because a PRIOR request taught the archive this
   *  phrasing. Worth saying out loud: it is the loop paying off. */
  const [askMatches, setAskMatches] = useState<Set<string>>(new Set());
  /** Prior requests whose released records may already answer this. Fetched
   *  only when the archive comes up empty — the moment before filing. */
  const [priorAnswers, setPriorAnswers] = useState<PriorAnswerCard[]>([]);
  const [searching, setSearching] = useState(false);
  const [downloaded, setDownloaded] = useState<string | null>(null);
  const seq = useRef(0);

  // Multi-turn agent thread (§6.7 answer → narrow → file). Empty = search-only.
  const [thread, setThread] = useState<AgentTurn[]>([]);
  const [asking, startAsking] = useTransition();
  const [agentDown, setAgentDown] = useState(!aiEnabled);

  const asked = query.trim().length >= 3;
  /** A conversation is open. From here the box is a CHAT composer, not a
   *  search field — the first answer is the moment the affordance has to
   *  change, or people read the reply and leave (owner, 2026-08-14). If the
   *  agent went down mid-thread we fall back to search: the turns stay on
   *  screen, but nothing invites a reply that can't be answered. */
  const chatting = thread.length > 0 && aiEnabled && !agentDown;

  function ask() {
    const message = query.trim();
    if (!aiEnabled || agentDown || message.length < 3 || asking) return;
    const history = thread.map((t) => ({ role: t.role, text: t.text }));
    setThread((prev) => [...prev, { role: "user", text: message }]);
    setQuery("");
    startAsking(async () => {
      const res = await askRecordsAgentAction({ agencySlug, history, message });
      if (!res.enabled) {
        setAgentDown(true); // degrade to instant search; keep what they typed
        setThread((prev) => prev.slice(0, -1));
        setQuery(message);
        return;
      }
      // Deflections stay honest: logged on actual downloads (the buttons on
      // cited records) and scope-downs — never merely for answering.
      setThread((prev) => [
        ...prev,
        {
          role: "assistant",
          text: res.message,
          items: res.items,
          intent: res.intent,
          // Only a draft_request turn may offer a drafted request. Models
          // sometimes return scratch text in suggestedRequest while ANSWERING;
          // rendering that as "here's your request" is worse than useless.
          suggestedRequest: res.intent === "draft_request" ? res.suggestedRequest : null,
        },
      ]);
    });
  }

  // Debounced live search against the tenant's public corpus. Silent once a
  // conversation is open: the agent already searches that corpus, and a
  // second results card sprouting under the thread as you type a follow-up
  // reads as "your reply went to the search box".
  useEffect(() => {
    if (!asked || chatting) {
      setResults([]);
      return;
    }
    const mine = ++seq.current;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const found = await searchArchiveAction(agencySlug, query);
        if (seq.current !== mine) return;
        setResults(found.items);
        setWindowNote(found.window);
        setAskMatches(new Set(found.matchedByAsk));
        // Nothing published matches. Before offering a form, check whether an
        // earlier request already produced the answer.
        if (found.items.length === 0) {
          const prior = await findPriorAnswersAction(agencySlug, query.trim());
          if (seq.current === mine) setPriorAnswers(prior.matches);
        } else {
          setPriorAnswers([]);
        }
      } finally {
        if (seq.current === mine) setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query, asked, chatting, agencySlug]);

  function download(item: ArchiveItem) {
    setDownloaded(item.id);
    // A served download = a request that never needed filing. Log it.
    void logDeflectionAction({ agencySlug, kind: "download", query: query.trim(), documentId: item.id });
  }

  function loggedFileLink() {
    // Filing after seeing partial answers = a narrower request (scope_down).
    // Filing after seeing NOTHING = an archive miss — unmet demand the
    // disclosure librarian mines (0 hours avoided; never counted as ROI).
    if (results.length > 0) {
      void logDeflectionAction({ agencySlug, kind: "scope_down", query: query.trim() });
    } else if (query.trim().length >= 3) {
      void logDeflectionAction({ agencySlug, kind: "archive_miss", query: query.trim() });
    }
  }

  const composer = (
    <div style={{ position: "relative" }}>
      <span
        aria-hidden
        style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "var(--muted)" }}
      >
        {chatting ? <ReplyIcon /> : <SearchIcon />}
      </span>
      <input
        className="field"
        style={{
          paddingLeft: 44,
          fontSize: "1.05rem",
          paddingBlock: 15,
          paddingRight: aiEnabled && !agentDown ? 92 : undefined,
        }}
        placeholder={
          chatting
            ? "Reply — e.g. just 2024, or who signed it?"
            : aiEnabled && !agentDown
              ? "Ask anything — e.g. how much did the Acme paving contract cost?"
              : "e.g. the Acme paving contract, 2024 council minutes…"
        }
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") ask();
        }}
        aria-label={chatting ? "Reply to the records assistant" : "Search public records"}
        autoComplete="off"
      />
      {aiEnabled && !agentDown && (
        <button
          className="btn btn-sm btn-primary"
          style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)" }}
          disabled={query.trim().length < 3 || asking}
          onClick={ask}
        >
          {chatting ? "Send" : "Ask"}
          {chatting && <SendIcon />}
        </button>
      )}
    </div>
  );

  return (
    <div>
      {/* Before the first question the composer leads the page. Once a
          conversation exists it docks INSIDE the thread card below, where a
          chat's reply box belongs — the box is never in two places at once. */}
      {!chatting && composer}

      {/* The agent conversation (§6.7): answer → narrow → file. */}
      {thread.length > 0 && (
        <div className="card" style={{ marginTop: 12, padding: 0, overflow: "hidden", textAlign: "left" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 16px",
              borderBottom: "1px solid var(--border)",
              background: "var(--ai-tint)",
              color: "var(--ai)",
              fontWeight: 600,
              fontSize: "0.86rem",
            }}
          >
            <SparkIcon />
            Records assistant
            <span className="muted hide-sm" style={{ fontWeight: 400, marginLeft: "auto" }}>
              Answers come from records this agency has already published
            </span>
          </div>
          {thread.map((turn, i) =>
            turn.role === "user" ? (
              <div key={i} style={{ padding: "10px 16px", display: "flex", gap: 8 }}>
                <span className="muted" style={{ fontSize: "0.82rem", flex: "none", marginTop: 2 }}>
                  You
                </span>
                <span style={{ fontWeight: 550 }}>{turn.text}</span>
              </div>
            ) : (
              <div key={i} style={{ padding: "10px 16px", borderTop: "1px solid var(--border)" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <span style={{ color: "var(--ai)", flex: "none", marginTop: 2 }}>
                    <SparkIcon />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: "0.95rem", whiteSpace: "pre-wrap" }}>{turn.text}</p>
                    {turn.items && turn.items.length > 0 && (
                      <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, display: "grid", gap: 8 }}>
                        {turn.items.map((r) => (
                          <li
                            key={r.id}
                            style={{ display: "flex", gap: 12, alignItems: "flex-start", border: "1px solid var(--border)", borderRadius: "var(--r)", padding: "10px 12px" }}
                          >
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 600, fontSize: "0.92rem" }}>
                                <Link href={`/${agencySlug}/archive/${r.id}`} style={{ color: "var(--ink)" }}>
                                  {r.title}
                                </Link>
                              </div>
                              <div className="muted" style={{ fontSize: "0.82rem", marginTop: 2 }}>
                                Released {r.date}
                              </div>
                            </div>
                            {r.downloadUrl ? (
                              <a
                                className={`btn btn-sm ${downloaded === r.id ? "" : "btn-primary"}`}
                                href={r.downloadUrl}
                                download
                                onClick={() => download(r)}
                              >
                                {downloaded === r.id ? "✓ Downloaded" : "Download"}
                              </a>
                            ) : (
                              <span className="tag">Summary</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {turn.intent === "draft_request" && turn.suggestedRequest && (
                      <div style={{ marginTop: 10, border: "1px solid var(--border)", borderRadius: "var(--r)", padding: "10px 12px", background: "var(--surface-2)" }}>
                        <div className="muted" style={{ fontSize: "0.78rem" }}>Drafted request — file it as-is or edit:</div>
                        <p style={{ margin: "4px 0 0", fontSize: "0.9rem", fontStyle: "italic" }}>
                          “{turn.suggestedRequest}”
                        </p>
                        <Link
                          href={`/${agencySlug}/request?q=${encodeURIComponent(turn.suggestedRequest)}`}
                          className="btn btn-sm btn-primary"
                          style={{ marginTop: 8 }}
                          onClick={loggedFileLink}
                        >
                          File this request →
                        </Link>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ),
          )}
          {asking && (
            <div className="muted" style={{ padding: "10px 16px", borderTop: "1px solid var(--border)", fontSize: "0.9rem" }}>
              <SparkIcon /> Checking the public archive…
            </div>
          )}

          {/* The docked reply box — the whole point of the card being a card.
              An answer with no visible way to respond reads as a finished
              search result, and the next question gets typed nowhere. */}
          {chatting && (
            <div
              style={{
                borderTop: "1px solid var(--border)",
                padding: "12px 14px 14px",
                background: "var(--surface-2)",
              }}
            >
              {composer}
              <div className="muted" style={{ fontSize: "0.8rem", marginTop: 8 }}>
                Keep going — the assistant remembers this conversation. Narrow the dates, ask who
                signed it, or ask it to draft a request.
              </div>
            </div>
          )}
        </div>
      )}

      {asked && !chatting && (
        <div className="card" style={{ marginTop: 12, overflow: "hidden", textAlign: "left" }}>
          {searching && results.length === 0 ? (
            <div className="muted" style={{ padding: "16px 20px", fontSize: "0.92rem" }}>
              Searching the public archive…
            </div>
          ) : results.length > 0 ? (
            <>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "12px 16px",
                  background: "var(--ai-tint)",
                  borderBottom: "1px solid var(--border)",
                  color: "var(--ai)",
                  fontWeight: 600,
                  fontSize: "0.9rem",
                }}
              >
                <SparkIcon />
                Found {results.length} public record{results.length === 1 ? "" : "s"} that may answer this — no request needed.
              </div>
              {windowNote && (
                <div
                  className="muted"
                  style={{
                    padding: "9px 16px",
                    borderBottom: "1px solid var(--border)",
                    fontSize: "0.85rem",
                  }}
                >
                  Showing <strong>{windowNote.subject}</strong> dated {windowNote.label}. Undated
                  records are included.
                </div>
              )}
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {results.map((r) => (
                  <li
                    key={r.id}
                    style={{
                      display: "flex",
                      gap: 14,
                      padding: "16px",
                      borderBottom: "1px solid var(--border)",
                      alignItems: "flex-start",
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>
                        <Link href={`/${agencySlug}/archive/${r.id}`} style={{ color: "var(--ink)" }}>
                          {r.title}
                        </Link>
                      </div>
                      <div className="muted" style={{ fontSize: "0.9rem", marginTop: 3 }}>
                        {r.summary}
                      </div>
                      {askMatches.has(r.id) && (
                        <div
                          style={{
                            marginTop: 6,
                            fontSize: "0.82rem",
                            color: "var(--ai)",
                            fontWeight: 500,
                          }}
                        >
                          Someone asked for this before — it was released in response to an earlier
                          request.
                        </div>
                      )}
                      {r.connectedSource && (
                        <div style={{ marginTop: 6, fontSize: "0.82rem", color: "var(--ai)" }}>
                          Automated answer from the city&apos;s public data ({r.connectedSource.sourceName},
                          last synced {r.connectedSource.syncedAt.slice(0, 10)}) — not a records
                          determination. File a request if this doesn&apos;t answer your question.
                        </div>
                      )}
                      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                        {r.connectedSource ? (
                          <ConnectedDataTag stamp={r.connectedSource} />
                        ) : (
                          <span className="tag">Released {r.date}</span>
                        )}
                        {r.tags.map((t) => (
                          <span key={t} className="tag">
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                    {r.downloadUrl ? (
                      <a
                        className={`btn btn-sm ${downloaded === r.id ? "" : "btn-primary"}`}
                        href={r.downloadUrl}
                        download
                        onClick={() => download(r)}
                      >
                        {downloaded === r.id ? "✓ Downloaded" : "Download"}
                      </a>
                    ) : (
                      <span className="tag" title="Summary entry — no file attached">
                        Summary
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              <div style={{ padding: "12px 16px", fontSize: "0.9rem" }} className="muted">
                Not what you needed?{" "}
                <Link
                  href={`/${agencySlug}/request?q=${encodeURIComponent(query.trim())}`}
                  onClick={loggedFileLink}
                >
                  File a formal request
                </Link>{" "}
                — we&apos;ll pre-fill what you&apos;ve told us.
              </div>
            </>
          ) : (
            <div style={{ padding: "20px 16px" }}>
              {priorAnswers.length > 0 && (
                <div style={{ marginBottom: 18 }}>
                  <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
                    <SparkIcon />
                    Someone asked for this before.
                  </div>
                  {priorAnswers.map((m) => (
                    <div
                      key={m.publicId}
                      className="card card-pad"
                      style={{ marginTop: 10, padding: 14 }}
                    >
                      <div className="muted" style={{ fontSize: "0.82rem" }}>
                        Request {m.publicId} · {m.coverage === "full" ? "answers this" : "answers part of this"}
                      </div>
                      <div style={{ fontSize: "0.93rem", marginTop: 4 }}>{m.rationale}</div>
                      <ul style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: "0.92rem" }}>
                        {m.documents.map((d) => (
                          <li key={d.id} style={{ marginBottom: 3 }}>
                            <Link href={`/${agencySlug}/archive/${d.id}`}>{d.title}</Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                  <p className="muted" style={{ fontSize: "0.85rem", marginTop: 10 }}>
                    Not what you needed? File a request below — this is a suggestion, not an answer
                    on the record.
                  </p>
                </div>
              )}
              {/* A window that filtered everything out must SAY so. Otherwise
                  "nothing matches" is indistinguishable from "nothing exists",
                  and the resident files a request for a record we already
                  publish — just outside the dates they happened to name. */}
              {windowNote ? (
                <>
                  <div style={{ fontWeight: 600 }}>
                    No public record for “{windowNote.subject}” dated {windowNote.label}.
                  </div>
                  <p className="muted" style={{ fontSize: "0.92rem", marginTop: 4 }}>
                    There may be records outside those dates — try widening the range, or drop the
                    dates to search everything. If it still isn&apos;t here, it may not be published
                    yet.
                  </p>
                  <button
                    type="button"
                    className="btn"
                    style={{ marginTop: 12, marginRight: 8 }}
                    onClick={() => setQuery(windowNote.subject)}
                  >
                    Search “{windowNote.subject}” with no date limit
                  </button>
                </>
              ) : (
                <>
                  <div style={{ fontWeight: 600 }}>No public record matches that yet.</div>
                  <p className="muted" style={{ fontSize: "0.92rem", marginTop: 4 }}>
                    That doesn&apos;t mean the record doesn&apos;t exist — it may not be published.
                    File a request and the records office will search their systems.
                  </p>
                </>
              )}
              <Link
                href={`/${agencySlug}/request?q=${encodeURIComponent(query.trim())}`}
                className="btn btn-primary"
                style={{ marginTop: 12 }}
              >
                File a request for “{query.trim()}”
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The composer's leading glyph in chat mode. A magnifier there is the bug
 *  the owner reported: it says "search field" to someone who is mid-reply. */
function ReplyIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.8-.8L3 20.5l1.4-4a8.3 8.3 0 0 1-.9-3.8 8.4 8.4 0 0 1 8.4-8.2h.5a8.4 8.4 0 0 1 8.6 7z" strokeLinejoin="round" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
      <path d="M5 12h13M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" strokeLinecap="round" />
    </svg>
  );
}
