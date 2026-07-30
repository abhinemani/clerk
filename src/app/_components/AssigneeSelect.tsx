"use client";

/**
 * Request-owner picker (§6.3 queue ergonomics). Auto-assignment proposes an
 * owner at intake; this is the human override — reassignment is one change,
 * logged as a named-actor assignment event by the server action.
 */
import { useState, useTransition } from "react";
import { assignCoordinatorAction } from "../[agency]/app/(secure)/requests/[id]/actions";

export function AssigneeSelect({
  agencySlug,
  requestId,
  staff,
  assigneeId,
}: {
  agencySlug: string;
  requestId: string;
  staff: { id: string; name: string }[];
  assigneeId: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <select
        aria-label="Assigned coordinator"
        className="field"
        style={{ width: "100%", marginTop: 8 }}
        defaultValue={assigneeId ?? ""}
        disabled={pending}
        onChange={(e) => {
          const value = e.target.value || null;
          setError(null);
          startTransition(async () => {
            const res = await assignCoordinatorAction({
              agencySlug,
              requestId,
              coordinatorUserId: value,
            });
            if (!res.ok) setError(res.error);
          });
        }}
      >
        <option value="">Unassigned</option>
        {staff.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      {error && (
        <p style={{ color: "var(--overdue)", fontSize: "0.8rem", margin: "6px 0 0" }}>{error}</p>
      )}
    </div>
  );
}
