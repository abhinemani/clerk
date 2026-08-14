"use client";

/**
 * Fulfillment agent controls (spec §16.1, v1 — opt-in, demo tenant first).
 * The toggle only decides whether the agent can be STARTED; what it may do is
 * fixed in code by its allowlist and the tier system, not by settings.
 */
import { useState, useTransition } from "react";
import { setFulfillmentAgentAction } from "../[agency]/app/(secure)/admin/actions";

export function FulfillmentAgentPanel({
  agencySlug,
  enabled,
}: {
  agencySlug: string;
  enabled: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const save = (nextEnabled: boolean) => {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const r = await setFulfillmentAgentAction({ agencySlug, enabled: nextEnabled });
      if (!r.ok) setError(r.error);
      else setSaved(true);
    });
  };

  return (
    <div className="card card-pad" style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div className="panel-title">Fulfillment agent</div>
          <p className="muted" style={{ fontSize: "0.85rem", margin: "6px 0 0", maxWidth: 520 }}>
            Adds a &ldquo;Run fulfillment agent&rdquo; button to request pages: the agent
            decomposes the request&apos;s scope, searches your records, attaches candidate
            documents to the review set, and plans department tasks. Every planned task waits
            for a named approval on the Agents page before any email goes out, and release,
            denial, and redaction decisions remain yours — the agent cannot reach them.
          </p>
        </div>
        <label style={{ display: "inline-flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={enabled}
            disabled={pending}
            onChange={(e) => save(e.target.checked)}
          />
          <span style={{ fontSize: "0.9rem", fontWeight: 600 }}>{enabled ? "On" : "Off"}</span>
        </label>
      </div>

      {error && (
        <p className="pill band-overdue" role="alert" style={{ marginTop: 8, justifySelf: "start" }}>
          {error}
        </p>
      )}
      {saved && !error && (
        <p className="muted" style={{ fontSize: "0.82rem", marginTop: 8 }}>
          Saved.
        </p>
      )}
    </div>
  );
}
