"use client";

/** One-click "attach to request" from a records-search result (§6.4). */
import { useState, useTransition } from "react";
import { attachToRequestAction } from "../[agency]/app/(secure)/search/actions";

export function AttachButton({
  agencySlug,
  requestId,
  documentId,
  attached,
}: {
  agencySlug: string;
  requestId: string;
  documentId: string;
  attached: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(attached);
  const [error, setError] = useState<string | null>(null);

  if (done) return <span className="pill band-on_track">In review set ✓</span>;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      {error && (
        <span style={{ color: "var(--overdue)", fontSize: "0.8rem" }}>{error}</span>
      )}
      <button
        className="btn btn-sm btn-primary"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const res = await attachToRequestAction({ agencySlug, requestId, documentId });
            if (res.ok) setDone(true);
            else setError(res.error);
          });
        }}
      >
        {pending ? "Attaching…" : "Attach to request"}
      </button>
    </span>
  );
}
