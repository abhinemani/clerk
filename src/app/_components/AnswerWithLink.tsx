"use client";

/**
 * "Answer with this link" — one click turns an archive match into the
 * response: letter with the permalink goes out under the staff name, the
 * request closes as fulfilled by reference. The inline confirm keeps a
 * mis-click from writing to a resident.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fulfillByReferenceAction } from "../[agency]/app/(secure)/requests/[id]/actions";

export function AnswerWithLink({
  agencySlug,
  requestId,
  documentId,
  title,
  requesterHasEmail,
}: {
  agencySlug: string;
  requestId: string;
  documentId: string;
  title: string;
  requesterHasEmail: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!confirming) {
    return (
      <button
        className="btn btn-sm"
        style={{ marginLeft: 8, fontSize: "0.78rem", paddingBlock: 3 }}
        onClick={() => setConfirming(true)}
      >
        Answer with this link…
      </button>
    );
  }

  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginLeft: 8 }}>
      <span style={{ fontSize: "0.8rem" }}>
        Send “{title}” as the answer and close as <strong>fulfilled</strong>?
        {!requesterHasEmail && (
          <span className="muted"> (Requester left no email — they&apos;ll see it on the tracker.)</span>
        )}
      </span>
      <button
        className="btn btn-sm btn-primary"
        style={{ fontSize: "0.78rem", paddingBlock: 3 }}
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const res = await fulfillByReferenceAction({ agencySlug, requestId, documentId });
            if (!res.ok) {
              setError(res.error);
              return;
            }
            router.refresh();
          });
        }}
      >
        {pending ? "Sending…" : "Send & close"}
      </button>
      <button
        className="btn btn-sm btn-ghost"
        style={{ fontSize: "0.78rem", paddingBlock: 3 }}
        disabled={pending}
        onClick={() => setConfirming(false)}
      >
        Cancel
      </button>
      {error && <span style={{ color: "var(--overdue)", fontSize: "0.78rem" }}>{error}</span>}
    </span>
  );
}
