/**
 * Per-request defensibility report (spec §10): "Append-only RequestEvent audit
 * trail; exportable per request — this is the 'defensibility report' for
 * litigation."
 *
 * Renders the append-only event log into a structured, human-readable record:
 * every state change, message, AI action (with model + prompt version),
 * approval, delivery — with a named human on anything legally significant. Pure;
 * a caller turns the text into a PDF.
 */
import type { EventEntity } from "@/services/repository";

export interface AuditReportInput {
  agencyName: string;
  request: {
    publicId: string;
    rawText: string;
    status: string;
    receivedAt?: Date | null;
    statutoryDueAt?: Date | null;
  };
  events: EventEntity[];
  /** Resolve an actorUserId to a real name/email for the printed report;
   *  falls back to "user:<id>" when a user isn't in the map (e.g. since
   *  removed from the roster — the id still proves who acted at the time). */
  actorNameById?: Map<string, string>;
}

export interface AuditEntry {
  at: string;
  kind: EventEntity["kind"];
  summary: string;
  actor: string;
  detail?: string;
}

export interface DefensibilityReport {
  title: string;
  request: AuditReportInput["request"];
  entries: AuditEntry[];
  /** Counts that a reviewer/attorney checks at a glance. */
  integrity: {
    totalEvents: number;
    aiActions: number;
    humanApprovals: number;
    deliveries: number;
    /** Every AI action carries a model + prompt version (auditable). */
    aiActionsFullyAttributed: boolean;
  };
}

function fmt(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 19) + "Z";
}

export function buildDefensibilityReport(input: AuditReportInput): DefensibilityReport {
  const ordered = [...input.events].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const entries: AuditEntry[] = ordered.map((e) => {
    const p = e.payload ?? {};
    let detail: string | undefined;
    if (e.kind === "ai_action") {
      detail = `model=${p.model ?? "?"} prompt=${p.promptVersion ?? "?"}`;
    } else if (e.kind === "delivery") {
      detail = p.to ? `to ${p.to} via ${p.channel ?? "?"}` : undefined;
    } else if (e.kind === "status_change" && p.from) {
      detail = `${p.from} → ${p.to}`;
    }
    const actor = e.actorUserId
      ? (input.actorNameById?.get(e.actorUserId) ?? `user:${e.actorUserId}`)
      : "system/AI";
    return {
      at: fmt(e.createdAt),
      kind: e.kind,
      summary: e.summary,
      actor,
      detail,
    };
  });

  const aiActions = ordered.filter((e) => e.kind === "ai_action");
  const aiFullyAttributed = aiActions.every((e) => e.payload?.model && e.payload?.promptVersion);

  return {
    title: `Defensibility report — ${input.request.publicId} · ${input.agencyName}`,
    request: input.request,
    entries,
    integrity: {
      totalEvents: ordered.length,
      aiActions: aiActions.length,
      humanApprovals: ordered.filter((e) => e.kind === "approval").length,
      deliveries: ordered.filter((e) => e.kind === "delivery").length,
      aiActionsFullyAttributed: aiFullyAttributed,
    },
  };
}

/** Plain-text / Markdown rendering for export (PDF wraps this later). */
export function renderAuditText(report: DefensibilityReport): string {
  const r = report.request;
  const lines = [
    report.title,
    "=".repeat(report.title.length),
    "",
    `Status: ${r.status}`,
    r.receivedAt ? `Received: ${fmt(r.receivedAt)}` : "",
    r.statutoryDueAt ? `Statutory due: ${fmt(r.statutoryDueAt)}` : "",
    "",
    "Request as filed (immutable):",
    `  "${r.rawText}"`,
    "",
    "Audit trail (append-only):",
    ...report.entries.map(
      (e) => `  ${e.at}  [${e.kind}] ${e.summary}${e.detail ? ` (${e.detail})` : ""} — ${e.actor}`,
    ),
    "",
    "Integrity summary:",
    `  ${report.integrity.totalEvents} events · ${report.integrity.aiActions} AI actions · ${report.integrity.humanApprovals} human approvals · ${report.integrity.deliveries} deliveries`,
    `  AI actions fully attributed (model + prompt version): ${report.integrity.aiActionsFullyAttributed ? "yes" : "NO — REVIEW"}`,
  ];
  return lines.filter((l) => l !== "").join("\n");
}
