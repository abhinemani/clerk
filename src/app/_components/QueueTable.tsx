"use client";

/**
 * Queue table with bulk selection (§6.3 ergonomics at volume). Selection
 * lives here (client state); each row still routes through the SAME
 * per-request assignCoordinator use case as the detail-page select — a
 * bulk action is a batch of individually-audited actions, not a new
 * unaudited code path.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import type { RiskBand } from "@/domain/deadlineRisk";
import { daysLabel, dateShort, requestStatusLabel, titleCase } from "@/lib/format";
import { AiPill, Avatar, DeadlineBand, RiskMeter, StatusPill } from "./ui";
import { bulkAssignCoordinatorAction } from "../[agency]/app/(secure)/actions";

const BAND_LABEL: Record<RiskBand, string> = {
  overdue: "Overdue",
  due_soon: "Due soon",
  on_track: "On track",
};

export interface QueueRowVM {
  id: string;
  publicId: string;
  interpretedScope: string;
  requesterName: string;
  requesterType: string;
  status: string;
  triageReady: boolean;
  redFlags: string[];
  assignedCoordinatorId: string | null;
  assignedCoordinatorName: string | null;
  dueAtISO: string;
  riskBand: RiskBand;
  riskScore: number;
  daysRemaining: number;
}

export function QueueTable({
  agencySlug,
  currentUserId,
  rows,
  assignableStaff,
  emptyMessage,
}: {
  agencySlug: string;
  currentUserId: string;
  rows: QueueRowVM[];
  assignableStaff: { id: string; name: string }[];
  emptyMessage: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState("");
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  const allSelected = rows.length > 0 && selected.size === rows.length;
  const rowIds = useMemo(() => rows.map((r) => r.id), [rows]);

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rowIds));
  }
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function runBulkAssign() {
    setNote(null);
    startTransition(async () => {
      const res = await bulkAssignCoordinatorAction({
        agencySlug,
        requestIds: [...selected],
        coordinatorUserId: target || null,
      });
      if (!res.ok) {
        setNote(res.error);
        return;
      }
      setNote(`Assigned ${res.assigned}${res.failed ? `, ${res.failed} failed` : ""}.`);
      setSelected(new Set());
      router.refresh();
    });
  }

  return (
    <>
      {selected.size > 0 && (
        <div
          className="card"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 14px",
            marginBottom: 10,
            flexWrap: "wrap",
            borderColor: "var(--accent)",
          }}
        >
          <strong style={{ fontSize: "0.9rem" }}>{selected.size} selected</strong>
          <select
            className="field"
            style={{ fontSize: "0.85rem", padding: "6px 8px", width: "auto" }}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            aria-label="Assign selected requests to"
          >
            <option value="">Unassign</option>
            {assignableStaff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button className="btn btn-sm btn-primary" disabled={pending} onClick={runBulkAssign}>
            {pending ? "Assigning…" : "Assign"}
          </button>
          <button className="btn btn-sm btn-ghost" disabled={pending} onClick={() => setSelected(new Set())}>
            Clear
          </button>
          {note && <span className="muted" style={{ fontSize: "0.85rem" }}>{note}</span>}
        </div>
      )}

      <div className="card" style={{ overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table className="queue">
            <thead>
              <tr>
                <th style={{ width: 32 }}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Select all open requests"
                  />
                </th>
                <th style={{ width: 120 }}>Deadline</th>
                <th>Request</th>
                <th className="hide-sm">Requester</th>
                <th className="hide-sm">Status</th>
                <th style={{ width: 90 }}>Risk</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={() => toggleOne(r.id)}
                      aria-label={`Select ${r.publicId}`}
                    />
                  </td>
                  <td>
                    <DeadlineBand band={r.riskBand} label={BAND_LABEL[r.riskBand]} />
                    <div className="muted" style={{ fontSize: "0.8rem", marginTop: 5 }}>
                      {dateShort(new Date(r.dueAtISO))} · {daysLabel(r.daysRemaining)}
                    </div>
                  </td>
                  <td>
                    <Link href={`/${agencySlug}/app/requests/${r.id}`} style={{ fontWeight: 600, color: "var(--ink)" }}>
                      {r.interpretedScope}
                    </Link>
                    <div style={{ display: "flex", gap: 8, marginTop: 6, alignItems: "center", flexWrap: "wrap" }}>
                      <span className="mono muted">{r.publicId}</span>
                      {r.assignedCoordinatorName && (
                        <span
                          className="pill"
                          title="Assigned coordinator"
                          style={r.assignedCoordinatorId === currentUserId ? { fontWeight: 600 } : undefined}
                        >
                          {r.assignedCoordinatorId === currentUserId ? "Mine" : r.assignedCoordinatorName}
                        </span>
                      )}
                      {r.triageReady && <AiPill>Triage ready</AiPill>}
                      {r.redFlags.map((f) => (
                        <span key={f} className="pill band-overdue" title="Statutory red flag">
                          {titleCase(f)}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="hide-sm">
                    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                      <Avatar name={r.requesterName} />
                      <div>
                        <div style={{ fontSize: "0.9rem", fontWeight: 500 }}>{r.requesterName}</div>
                        <div className="muted" style={{ fontSize: "0.78rem" }}>
                          {titleCase(r.requesterType)}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="hide-sm">
                    <StatusPill label={requestStatusLabel(r.status)} />
                  </td>
                  <td>
                    <RiskMeter score={r.riskScore} band={r.riskBand} />
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted" style={{ padding: 20 }}>
                    {emptyMessage}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
