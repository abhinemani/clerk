"use client";

/**
 * Requester API + MCP server controls (docs/requester-api.md). Opt-in, same
 * posture as the status API card next to it: everything served is a
 * projection of what the portal already shows anyone; filing gets its own
 * toggle because it is the one write.
 */
import { useState, useTransition } from "react";
import { setRequesterApiAction } from "../[agency]/app/(secure)/admin/actions";

export function RequesterApiPanel({
  agencySlug,
  enabled,
  filingEnabled,
}: {
  agencySlug: string;
  enabled: boolean;
  filingEnabled: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const save = (nextEnabled: boolean, nextFiling: boolean) => {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const r = await setRequesterApiAction({
        agencySlug,
        enabled: nextEnabled,
        filingEnabled: nextFiling,
      });
      if (!r.ok) setError(r.error);
      else setSaved(true);
    });
  };

  return (
    <div className="card card-pad">
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div className="panel-title">Requester API &amp; MCP server</div>
          <p className="muted" style={{ fontSize: "0.85rem", margin: "6px 0 0", maxWidth: 520 }}>
            Lets residents&apos; and newsrooms&apos; AI assistants use the portal directly:
            archive search at <span className="mono">/api/v1/{agencySlug}/archive?q=…</span> and an
            MCP endpoint at <span className="mono">/api/v1/{agencySlug}/mcp</span> (search, record
            reads, status by tracking number). Serves only what the public portal already shows
            anyone — enabling this never widens what a requester can see.
          </p>
        </div>
        <label style={{ display: "inline-flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={enabled}
            disabled={pending}
            onChange={(e) => save(e.target.checked, filingEnabled)}
          />
          <span style={{ fontSize: "0.9rem", fontWeight: 600 }}>{enabled ? "On" : "Off"}</span>
        </label>
      </div>

      <label
        style={{
          display: "inline-flex",
          gap: 8,
          alignItems: "center",
          cursor: enabled ? "pointer" : "not-allowed",
          marginTop: 12,
          opacity: enabled ? 1 : 0.5,
        }}
      >
        <input
          type="checkbox"
          checked={enabled && filingEnabled}
          disabled={pending || !enabled}
          onChange={(e) => save(enabled, e.target.checked)}
        />
        <span style={{ fontSize: "0.85rem" }}>
          Allow filing through the API (<span className="mono">file_request</span> — real requests
          with statutory deadlines; rate-limited)
        </span>
      </label>

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
