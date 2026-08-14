"use client";

/**
 * Status API + webhook controls (agentic-horizon: the §16.4 first brick).
 * Opt-in, same posture as the public request log: the API serves exactly
 * what the tracker already shows anyone holding a tracking number.
 */
import { useState, useTransition } from "react";
import { setStatusApiAction } from "../[agency]/app/(secure)/admin/actions";

export function StatusApiPanel({
  agencySlug,
  enabled,
  webhookUrl,
}: {
  agencySlug: string;
  enabled: boolean;
  webhookUrl: string | null;
}) {
  const [url, setUrl] = useState(webhookUrl ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const save = (nextEnabled: boolean) => {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const r = await setStatusApiAction({ agencySlug, enabled: nextEnabled, webhookUrl: url });
      if (!r.ok) setError(r.error);
      else setSaved(true);
    });
  };

  return (
    <div className="card card-pad">
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div className="panel-title">Status API &amp; webhook</div>
          <p className="muted" style={{ fontSize: "0.85rem", margin: "6px 0 0", maxWidth: 520 }}>
            Serves each request&apos;s tracker view as JSON at{" "}
            <span className="mono">/api/v1/{agencySlug}/requests/&#123;tracking-number&#125;</span> —
            exactly what anyone with the tracking number already sees, nothing more (no requester
            details, no correspondence). Useful to newsrooms and other systems watching their
            requests.
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

      <label style={{ display: "grid", gap: 4, marginTop: 12, maxWidth: 520 }}>
        <span className="lbl">Webhook URL (optional, https)</span>
        <input
          className="field mono"
          placeholder="https://example.com/hooks/records"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <span className="muted" style={{ fontSize: "0.78rem" }}>
          POSTed a short ping on every status change and deadline extension — tracking-number facts
          plus a link to the status API, which is the record to verify against. Delivery failures
          appear on the deployment health page.
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
      <div style={{ marginTop: 10 }}>
        <button className="btn btn-sm" disabled={pending} onClick={() => save(enabled)}>
          {pending ? "Saving…" : "Save webhook URL"}
        </button>
      </div>
    </div>
  );
}
