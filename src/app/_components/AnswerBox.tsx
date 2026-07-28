"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { ArchiveItem } from "@/lib/archive";
import { logDeflectionAction, searchArchiveAction } from "../[agency]/actions";
import { SparkIcon } from "./ui";

/**
 * The portal front door (§6.7): a question box, not a form. Answers from the
 * tenant's own public corpus first (deflection), and only pivots to filing a
 * request when the corpus can't help. Retrieval is hard-scoped to public
 * documents server-side; every download or scope-down is logged as a
 * Deflection — the ROI number agencies show their councils.
 */
export function AnswerBox({ agencySlug }: { agencySlug: string }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ArchiveItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [downloaded, setDownloaded] = useState<string | null>(null);
  const seq = useRef(0);

  const asked = query.trim().length >= 3;

  // Debounced live search against the tenant's public corpus.
  useEffect(() => {
    if (!asked) {
      setResults([]);
      return;
    }
    const mine = ++seq.current;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const found = await searchArchiveAction(agencySlug, query);
        if (seq.current === mine) setResults(found);
      } finally {
        if (seq.current === mine) setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query, asked, agencySlug]);

  function download(item: ArchiveItem) {
    setDownloaded(item.id);
    // A served download = a request that never needed filing. Log it.
    void logDeflectionAction({ agencySlug, kind: "download", query: query.trim(), documentId: item.id });
  }

  function loggedFileLink() {
    // Filing after seeing partial answers = a narrower request (scope_down).
    if (results.length > 0) {
      void logDeflectionAction({ agencySlug, kind: "scope_down", query: query.trim() });
    }
  }

  return (
    <div>
      <div style={{ position: "relative" }}>
        <span
          aria-hidden
          style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "var(--muted)" }}
        >
          <SearchIcon />
        </span>
        <input
          className="field"
          style={{ paddingLeft: 44, fontSize: "1.05rem", paddingBlock: 15 }}
          placeholder="e.g. the Acme paving contract, 2024 council minutes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search public records"
          autoComplete="off"
        />
      </div>

      {asked && (
        <div className="card" style={{ marginTop: 12, overflow: "hidden" }}>
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
                      <div style={{ fontWeight: 600 }}>{r.title}</div>
                      <div className="muted" style={{ fontSize: "0.9rem", marginTop: 3 }}>
                        {r.summary}
                      </div>
                      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                        <span className="tag">Released {r.date}</span>
                        {r.tags.map((t) => (
                          <span key={t} className="tag">
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                    <button
                      className={`btn btn-sm ${downloaded === r.id ? "" : "btn-primary"}`}
                      onClick={() => download(r)}
                    >
                      {downloaded === r.id ? "✓ Downloaded" : "Download"}
                    </button>
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
              <div style={{ fontWeight: 600 }}>No public record matches that yet.</div>
              <p className="muted" style={{ fontSize: "0.92rem", marginTop: 4 }}>
                That doesn&apos;t mean the record doesn&apos;t exist — it may not be published. File a
                request and the records office will search their systems.
              </p>
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

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" strokeLinecap="round" />
    </svg>
  );
}
