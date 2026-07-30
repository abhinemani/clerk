"use client";

/**
 * Keyword→department routing rules (src/domain/workflow.ts): explicit agency
 * policy, applied the moment a request is filed — no model, no API key. With
 * auto-dispatch on, a matching request's department tasks go out instantly;
 * with it off, matches appear as the usual routing proposal cards.
 */
import { useState, useTransition } from "react";
import { updateRoutingRulesAction } from "../[agency]/app/(secure)/admin/actions";

export function RoutingRulesPanel({
  agencySlug,
  departments,
  initial,
}: {
  agencySlug: string;
  departments: { id: string; name: string }[];
  /** departmentId → comma-joined keywords, from the stored rules. */
  initial: Record<string, string>;
}) {
  const [keywords, setKeywords] = useState<Record<string, string>>(
    Object.fromEntries(departments.map((d) => [d.id, initial[d.id] ?? ""])),
  );
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  const dirty = departments.some((d) => (keywords[d.id] ?? "") !== (initial[d.id] ?? ""));

  return (
    <div className="card card-pad">
      <p className="muted" style={{ fontSize: "0.88rem", margin: 0, maxWidth: 560 }}>
        When a new request mentions any of these terms, it routes to that department — instantly if
        auto-dispatch is on, as a suggestion card otherwise. Plain words match whole words;
        phrases match anywhere. Comma-separated.
      </p>
      <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
        {departments.map((d) => (
          <label key={d.id} style={{ display: "grid", gap: 4 }}>
            <span style={{ fontWeight: 550, fontSize: "0.9rem" }}>{d.name}</span>
            <input
              className="field"
              placeholder="e.g. pothole, paving, street light"
              value={keywords[d.id] ?? ""}
              onChange={(e) => setKeywords((prev) => ({ ...prev, [d.id]: e.target.value }))}
            />
          </label>
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 14 }}>
        <button
          className="btn btn-sm btn-primary"
          disabled={!dirty || pending}
          onClick={() => {
            setNote(null);
            startTransition(async () => {
              const res = await updateRoutingRulesAction({
                agencySlug,
                rules: departments.map((d) => ({ departmentId: d.id, keywords: keywords[d.id] ?? "" })),
              });
              setNote(res.ok ? "Saved." : res.error);
            });
          }}
        >
          {pending ? "Saving…" : "Save rules"}
        </button>
        {note && (
          <span className="muted" style={{ fontSize: "0.85rem" }}>
            {note}
          </span>
        )}
      </div>
    </div>
  );
}
