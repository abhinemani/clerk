/**
 * Appeal-defense packet (agentic-horizon B3) — the dossier counsel needs when
 * a decision is challenged, assembled from records the platform was already
 * keeping: the append-only audit trail (§10), the deadline's computation
 * bases (invariant 7), every per-document review decision with its exemption
 * label (§5), every letter, and every checksummed release (invariant 8).
 *
 * Pure builder, same rules as auditExport.ts: no I/O, no clock — callers pass
 * everything in, so the packet is deterministic and testable. The cover memo
 * is COMPOSED from the record (template, no model) and says so: it is a draft
 * for counsel, not a filing.
 */
import type {
  EventEntity,
  MessageEntity,
  ReleaseEntity,
  RequestEntity,
  ReviewEntity,
} from "@/services/repository";
import { buildDefensibilityReport, type DefensibilityReport } from "./auditExport";

export interface AppealPacketInput {
  agencyName: string;
  request: RequestEntity;
  events: EventEntity[];
  reviews: ReviewEntity[];
  messages: MessageEntity[];
  releases: ReleaseEntity[];
  /** Resolve ids to display names; unknown ids print as user:<id> (still evidence). */
  actorNameById?: Map<string, string>;
  documentNameById?: Map<string, string>;
  now: Date;
}

export interface ExemptionLine {
  document: string;
  decision: ReviewEntity["decision"];
  exemptionLabel: string | null;
  decidedBy: string;
}

export interface AppealPacket {
  title: string;
  generatedAt: string;
  /** Narrative draft for counsel — composed from the record, clearly marked. */
  coverMemo: string[];
  /** The deadline story: received → computed due → every extension with basis. */
  deadlineBasis: string[];
  /** Per-document review decisions with exemption labels — the citation log. */
  exemptions: ExemptionLine[];
  /** Every letter in and out (internal notes never leave the workspace). */
  correspondence: { at: string; direction: string; subject: string | null; sentBy: string; aiDrafted: boolean }[];
  /** Immutable releases with artifact checksums (invariant 8). */
  releases: { releasedAt: string; approvedBy: string; visibility: string; artifacts: { filename: string; checksum: string }[] }[];
  /** The full §10 audit report rides along — the packet's evidentiary spine. */
  audit: DefensibilityReport;
}

const fmt = (d: Date) => d.toISOString().replace("T", " ").slice(0, 19) + "Z";
const fmtDay = (d: Date) => d.toISOString().slice(0, 10);

export function buildAppealPacket(input: AppealPacketInput): AppealPacket {
  const { request } = input;
  const name = (id: string | null | undefined, fallback: string) =>
    id ? (input.actorNameById?.get(id) ?? `user:${id}`) : fallback;
  const docName = (id: string) => input.documentNameById?.get(id) ?? `document:${id}`;

  // --- deadline basis (invariant 7: every deadline move has a recorded basis)
  const deadlineBasis: string[] = [];
  if (request.receivedAt) deadlineBasis.push(`Received ${fmt(request.receivedAt)}`);
  if (request.statutoryDueAt) {
    deadlineBasis.push(
      `Statutory due date computed as ${fmtDay(request.statutoryDueAt)} (statute profile + calendar; deterministic, see audit trail)`,
    );
  }
  for (const ext of request.extensionHistory ?? []) {
    deadlineBasis.push(
      `Extended ${ext.days} day(s) on ${fmtDay(new Date(ext.at))} by ${name(ext.byUserId, "user:unknown")} — ${ext.reason}${
        ext.statutoryBasis ? ` (${ext.statutoryBasis})` : ""
      }`,
    );
  }
  if (request.closedAt) deadlineBasis.push(`Closed ${fmt(request.closedAt)} (status: ${request.status})`);

  // --- exemption log (per-document review decisions, each by a named human)
  const exemptions: ExemptionLine[] = [...input.reviews]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((r) => ({
      document: docName(r.documentId),
      decision: r.decision,
      exemptionLabel: r.exemptionLabel,
      decidedBy: name(r.decidedByUserId, "user:unknown"),
    }));

  // --- correspondence (internal notes excluded: they never leave the workspace)
  const correspondence = [...input.messages]
    .filter((m) => m.direction !== "internal_note")
    .sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime())
    .map((m) => ({
      at: fmt(m.sentAt),
      direction: m.direction,
      subject: m.subject,
      sentBy: name(m.sentByUserId, m.direction === "inbound" ? "requester" : "system"),
      aiDrafted: m.aiDrafted,
    }));

  // --- releases (immutable, checksummed — invariant 8)
  const releases = [...input.releases]
    .sort((a, b) => a.releasedAt.getTime() - b.releasedAt.getTime())
    .map((r) => ({
      releasedAt: fmt(r.releasedAt),
      approvedBy: name(r.approvedByUserId, "user:unknown"),
      visibility: r.visibility,
      artifacts: r.artifacts.map((a) => ({ filename: a.filename, checksum: a.checksum })),
    }));

  const audit = buildDefensibilityReport({
    agencyName: input.agencyName,
    request: {
      publicId: request.publicId,
      rawText: request.rawText,
      status: request.status,
      receivedAt: request.receivedAt,
      statutoryDueAt: request.statutoryDueAt,
    },
    events: input.events,
    actorNameById: input.actorNameById,
  });

  // --- cover memo: a narrative draft composed strictly from the record above
  const withheld = exemptions.filter((e) => e.decision === "withhold");
  const redacted = exemptions.filter((e) => e.decision === "release_redacted");
  const released = exemptions.filter((e) => e.decision === "release");
  const labels = [...new Set(exemptions.map((e) => e.exemptionLabel).filter(Boolean))] as string[];
  const outbound = correspondence.filter((c) => c.direction !== "inbound").length;
  const inbound = correspondence.length - outbound;

  const coverMemo = [
    `DRAFT COVER MEMO — composed from the request's append-only record; for counsel's review, not a filing.`,
    ``,
    `Request ${request.publicId} was received${request.receivedAt ? ` on ${fmtDay(request.receivedAt)}` : ""} and is currently "${request.status}". The request as filed (immutable, invariant 6): "${request.rawText}".${request.interpretedScope ? ` Interpreted scope on record: "${request.interpretedScope}".` : ""}`,
    ``,
    `Deadline posture: ${deadlineBasis.length > 0 ? deadlineBasis.join("; ") : "no statutory deadline recorded"}. Every deadline computation and extension persists with its basis; the audit trail below is append-only.`,
    ``,
    `Review outcomes: ${exemptions.length} document decision(s) — ${released.length} released, ${redacted.length} released with redactions, ${withheld.length} withheld.${labels.length > 0 ? ` Exemptions cited: ${labels.join(", ")}.` : ""} Each decision names its human decider.`,
    ``,
    `Correspondence: ${outbound} outbound letter(s)/message(s), ${inbound} inbound. Releases: ${releases.length}, each immutable and artifact-checksummed at creation.`,
    ``,
    `Integrity: ${audit.integrity.totalEvents} audit events, ${audit.integrity.humanApprovals} human approval(s), ${audit.integrity.aiActions} AI action(s)${audit.integrity.aiActionsFullyAttributed ? ", all AI actions fully attributed (model + prompt version)" : " — ATTENTION: not all AI actions carry full attribution; review before relying on them"}.`,
  ];

  return {
    title: `Appeal-defense packet — ${request.publicId} · ${input.agencyName}`,
    generatedAt: fmt(input.now),
    coverMemo,
    deadlineBasis,
    exemptions,
    correspondence,
    releases,
    audit,
  };
}

/** Plain-text rendering for export (the PDF route wraps this). */
export function renderAppealPacketText(p: AppealPacket): string {
  const lines: string[] = [
    p.title,
    "=".repeat(p.title.length),
    `Generated ${p.generatedAt}`,
    "",
    ...p.coverMemo,
    "",
    "I. DEADLINE COMPUTATION BASES (invariant 7)",
    ...(p.deadlineBasis.length > 0 ? p.deadlineBasis.map((l) => `  ${l}`) : ["  (none recorded)"]),
    "",
    "II. EXEMPTION LOG — per-document decisions",
    ...(p.exemptions.length > 0
      ? p.exemptions.map(
          (e) =>
            `  ${e.document}: ${e.decision}${e.exemptionLabel ? ` — ${e.exemptionLabel}` : ""} (by ${e.decidedBy})`,
        )
      : ["  (no review decisions recorded)"]),
    "",
    "III. CORRESPONDENCE (internal notes excluded)",
    ...(p.correspondence.length > 0
      ? p.correspondence.map(
          (c) =>
            `  ${c.at}  [${c.direction}] ${c.subject ?? "(no subject)"} — ${c.sentBy}${c.aiDrafted ? " (AI-drafted, human-sent)" : ""}`,
        )
      : ["  (none)"]),
    "",
    "IV. RELEASES (immutable, checksummed — invariant 8)",
    ...(p.releases.length > 0
      ? p.releases.flatMap((r) => [
          `  ${r.releasedAt}  ${r.visibility} release approved by ${r.approvedBy}`,
          ...r.artifacts.map((a) => `      ${a.filename}  sha256:${a.checksum}`),
        ])
      : ["  (none)"]),
    "",
    "V. FULL AUDIT TRAIL (append-only)",
    ...p.audit.entries.map(
      (e) => `  ${e.at}  [${e.kind}] ${e.summary}${e.detail ? ` (${e.detail})` : ""} — ${e.actor}`,
    ),
  ];
  return lines.join("\n");
}
