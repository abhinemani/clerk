"use client";

import { useState } from "react";
import { AnswerBox } from "./AnswerBox";
import { RequestTracker } from "./RequestTracker";

/** Resident front door: find a record now, or track a request already filed. */
export function PortalTabs({ agencySlug }: { agencySlug: string }) {
  const [tab, setTab] = useState<"find" | "track">("find");

  return (
    <div>
      <div
        role="tablist"
        aria-label="What would you like to do?"
        style={{
          display: "inline-flex",
          gap: 4,
          padding: 4,
          borderRadius: "var(--r-pill)",
          background: "var(--surface-2)",
          border: "1px solid var(--border)",
          marginBottom: 18,
        }}
      >
        {(
          [
            ["find", "Find a record"],
            ["track", "Track a request"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className="btn btn-sm"
            style={{
              border: "none",
              borderRadius: "var(--r-pill)",
              background: tab === key ? "var(--surface)" : "transparent",
              color: tab === key ? "var(--ink)" : "var(--ink-2)",
              boxShadow: tab === key ? "var(--shadow-sm)" : "none",
              fontWeight: 600,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "find" ? <AnswerBox agencySlug={agencySlug} /> : <RequestTracker agencySlug={agencySlug} />}
    </div>
  );
}
