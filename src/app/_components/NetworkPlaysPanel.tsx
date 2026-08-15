"use client";

/**
 * Network plays consent (docs/network-plays.md, invariant 11).
 *
 * THE COPY IS THE FEATURE HERE. Consent that doesn't state the tradeoff isn't
 * informed consent, and this particular tradeoff is real: exemption
 * benchmarking exists to reveal that an agency is an outlier, which is
 * exactly the number that could be cited against a contributor later. An
 * agency is entitled to know that before agreeing, so it is said plainly and
 * near the top — not softened, not moved below the fold, not left to a
 * tooltip. If you shorten this panel, keep the four honest facts: what
 * crosses, what does not, that it is a public record, and that revocation
 * cannot retract what was already computed.
 */
import { useState, useTransition } from "react";
import { setNetworkPlaysAction } from "../[agency]/app/(secure)/admin/actions";

export function NetworkPlaysPanel({
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
      const r = await setNetworkPlaysAction({ agencySlug, enabled: nextEnabled });
      if (!r.ok) setError(r.error);
      else setSaved(true);
    });
  };

  return (
    <div className="card card-pad" style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div className="panel-title">Network plays — learn from other agencies</div>
          <p className="muted" style={{ fontSize: "0.85rem", margin: "6px 0 0", maxWidth: 560 }}>
            Contribute anonymized statistics from your closed requests to
            cross-agency benchmarks, and read everyone else&apos;s in return — how
            comparable offices route a request type, how long it takes them, which
            exemptions they cite. A new office inherits that experience instead of
            spending a year earning it.
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

      <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
        <p className="muted" style={{ fontSize: "0.82rem", margin: 0, maxWidth: 560 }}>
          <strong>What leaves your tenant:</strong> only counted statistics expressed
          in our fixed vocabulary — a subject code, a department role, a statute
          section, and bucketed timings. <strong>Never:</strong> request text, a
          requester or staff name, a document, a tracking number, or anything typed by
          your staff. A request we can&apos;t express in that vocabulary contributes
          nothing at all.
        </p>
        <p className="muted" style={{ fontSize: "0.82rem", margin: 0, maxWidth: 560 }}>
          <strong>Nothing publishes until it&apos;s genuinely anonymous:</strong> a
          benchmark needs at least 5 consenting agencies and 20 closed requests behind
          it, with no single agency more than 40% of it. Below that we publish nothing
          rather than a blurred or rounded number.
        </p>
        <p className="muted" style={{ fontSize: "0.82rem", margin: 0, maxWidth: 560 }}>
          <strong>Worth knowing before you agree:</strong> these benchmarks are
          designed to show when an office is an outlier — that is what makes them
          useful, and it means the same figures could be cited in an appeal or a
          lawsuit involving any participating agency. No number identifies who
          contributed it, and the aggregate is itself a public record. Consider it a
          decision for whoever owns your disclosure posture, not just IT.
        </p>
        <p className="muted" style={{ fontSize: "0.82rem", margin: 0, maxWidth: 560 }}>
          <strong>Leaving:</strong> switch this off any time and the next weekly
          rebuild excludes you entirely. Benchmarks already computed are not recalled —
          they contain no trace of you to remove.
        </p>
      </div>

      {error && (
        <p className="pill band-overdue" role="alert" style={{ marginTop: 8, justifySelf: "start" }}>
          {error}
        </p>
      )}
      {saved && !error && (
        <p className="muted" style={{ fontSize: "0.82rem", marginTop: 8 }}>
          Saved — recorded in this agency&apos;s audit log.
        </p>
      )}
    </div>
  );
}
