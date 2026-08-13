"use client";

/**
 * Statutory-extension panel (§7): take the one permitted extension with a
 * statute-listed reason. The deadline math happens server-side in the pure
 * statute engine; this panel only collects the human's decision — and the
 * notice letter goes out through the same thread as everything else.
 */
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { extendRequestAction } from "../[agency]/app/(secure)/requests/[id]/actions";
import { PREFILL_EXTENSION_EVENT, type PrefillExtensionDetail } from "./prefillEvents";

export interface ExtensionTakenVM {
  days: number;
  reason: string;
  atLabel: string;
}

export function ExtensionPanel(props: {
  agencySlug: string;
  requestId: string;
  dueLabel: string;
  maxDays: number;
  dayType: "calendar" | "business";
  reasons: string[];
  taken: ExtensionTakenVM | null;
  /** False when the request is closed or the statute permits no extension. */
  available: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(props.maxDays);
  const [reason, setReason] = useState(props.reasons[0] ?? "");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const panelRef = useRef<HTMLDivElement>(null);

  // Copilot prefill: a propose_extension card opens this panel with the
  // proposed basis in the note. The DECISION stays here — days, statute
  // reason, and the Take button are untouched; only text was carried over.
  useEffect(() => {
    if (!props.available || props.taken) return;
    const onPrefill = (e: Event) => {
      const { note: proposed } = (e as CustomEvent<PrefillExtensionDetail>).detail;
      setOpen(true);
      setNote(proposed);
      requestAnimationFrame(() =>
        panelRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }),
      );
    };
    window.addEventListener(PREFILL_EXTENSION_EVENT, onPrefill);
    return () => window.removeEventListener(PREFILL_EXTENSION_EVENT, onPrefill);
  }, [props.available, props.taken]);

  function take() {
    setError(null);
    startTransition(async () => {
      const result = await extendRequestAction({
        agencySlug: props.agencySlug,
        requestId: props.requestId,
        days,
        reason,
        note: note.trim() || undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="card card-pad" ref={panelRef}>
      <div className="panel-title">Statutory deadline</div>
      <div style={{ fontWeight: 600, marginTop: 8 }}>{props.dueLabel}</div>

      {props.taken ? (
        <div style={{ marginTop: 8 }}>
          <span className="pill">Extension taken · {props.taken.atLabel}</span>
          <p className="muted" style={{ fontSize: "0.82rem", marginTop: 6, marginBottom: 0 }}>
            +{props.taken.days} day(s): {props.taken.reason}. The statute permits one extension —
            no further extensions are available.
          </p>
        </div>
      ) : !props.available ? null : !open ? (
        <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => setOpen(true)}>
          Take the statutory extension…
        </button>
      ) : (
        <div className="stack" style={{ gap: 8, marginTop: 10 }}>
          {error && (
            <p className="pill band-overdue" role="alert">
              {error}
            </p>
          )}
          <label className="lbl" htmlFor="ext-days">
            Days (max {props.maxDays} {props.dayType})
          </label>
          <input
            id="ext-days"
            type="number"
            className="field"
            min={1}
            max={props.maxDays}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          />
          <label className="lbl" htmlFor="ext-reason">
            Permitted reason
          </label>
          <select
            id="ext-reason"
            className="field"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          >
            {props.reasons.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <textarea
            className="field"
            rows={2}
            placeholder="Specifics for the notice letter (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-sm btn-primary" disabled={pending || !reason} onClick={take}>
              {pending ? "Extending…" : "Extend as yourself"}
            </button>
            <button className="btn btn-sm btn-ghost" disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
          <p className="muted" style={{ fontSize: "0.76rem", margin: 0 }}>
            The new date is computed by the statute engine and logged with its basis; the requester
            gets the notice letter automatically.
          </p>
        </div>
      )}
    </div>
  );
}
