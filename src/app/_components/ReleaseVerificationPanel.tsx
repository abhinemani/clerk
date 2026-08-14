"use client";

/**
 * Release verification controls (docs/release-verification.md). Opt-in,
 * same posture as the public request log: invariant 8's checksums were
 * always kept — this decides whether the public can use them.
 */
import { useState, useTransition } from "react";
import { setReleaseVerificationAction } from "../[agency]/app/(secure)/admin/actions";

export function ReleaseVerificationPanel({
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
      const r = await setReleaseVerificationAction({ agencySlug, enabled: nextEnabled });
      if (!r.ok) setError(r.error);
      else setSaved(true);
    });
  };

  return (
    <div className="card card-pad">
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div className="panel-title">Release verification</div>
          <p className="muted" style={{ fontSize: "0.85rem", margin: "6px 0 0", maxWidth: 520 }}>
            Publishes <span className="mono">/{agencySlug}/authenticity</span>: anyone holding a
            file this office released — a court, a newsroom, a skeptic — can confirm it is
            byte-identical to what was shipped. Every release is already checksummed at approval;
            this makes those checksums checkable. Files are fingerprinted in the visitor&apos;s
            browser and never uploaded.
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
