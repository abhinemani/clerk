import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepository } from "@/db/createRepository";
import { getAgencyForSlug } from "@/lib/live";
import { requireStaff } from "@/auth/guards";
import { readDocumentMeta, sensitivitySummary } from "@/domain/documentMeta";
import type { DocumentEntity, PublicationDecisionRow, PublicationState } from "@/services/repository";
import { PublicationQueue, type QueueDocVM } from "../../../../_components/PublicationQueue";

export const dynamic = "force-dynamic";

type Tab = "undecided" | "published" | "internal";

const DECISION_LABEL: Record<PublicationDecisionRow["decision"], string> = {
  published: "Published",
  kept_internal: "Kept internal",
  unpublished: "Unpublished",
};

function toVM(
  d: DocumentEntity,
  sourceNames: Map<string, string>,
  history: PublicationDecisionRow[] = [],
): QueueDocVM {
  const meta = readDocumentMeta(d);
  const preview = d.extractedText ? d.extractedText.slice(0, 240) : null;
  return {
    id: d.id,
    title: meta.title ?? d.filename ?? "Untitled record",
    filename: d.filename,
    sourceName: d.sourceId ? (sourceNames.get(d.sourceId) ?? "Connector") : "Uploaded",
    dateLabel: meta.recordDate ?? meta.releasedOn ?? d.createdAt.toISOString().slice(0, 10),
    recordType: d.recordType,
    summary: meta.summary ?? "",
    tags: meta.tags ?? [],
    keywords: meta.keywords ?? [],
    preview: preview && preview !== meta.title ? preview : null,
    hasFile: d.blobRef != null && d.byteSize != null,
    // Deterministic PII pre-scan tallies — the zero-API-key safety net; the
    // queue shows these in the alarm color, unlike the LLM's advisory note.
    piiSummary: sensitivitySummary(meta),
    ai: meta.aiClassification?.suggestedClassification
      ? {
          suggestedClassification: meta.aiClassification.suggestedClassification,
          recordType: meta.aiClassification.recordType ?? "",
          sensitivityNote: meta.aiClassification.sensitivityNote ?? null,
        }
      : null,
    decision: meta.publicationDecision
      ? {
          decision: meta.publicationDecision.decision,
          byName: meta.publicationDecision.byName,
          at: meta.publicationDecision.at.slice(0, 10),
        }
      : null,
    // The append-only trail (oldest first, reading order). Rows decided
    // before the history table existed fall back to the cache line above.
    history: history
      .slice()
      .reverse()
      .map((h) => ({
        label: DECISION_LABEL[h.decision],
        byName: h.byName,
        at: h.createdAt.toISOString().slice(0, 10),
        reason: h.reason,
      })),
  };
}

const PAGE_SIZE = 50;

/** ?before= cursor: "<createdAt ISO>_<id>" of the previous page's last row. */
function parseCursor(raw: string | undefined): { createdAt: Date; id: string } | undefined {
  if (!raw) return undefined;
  const sep = raw.indexOf("_");
  if (sep < 0) return undefined;
  const createdAt = new Date(raw.slice(0, sep));
  const id = raw.slice(sep + 1);
  return Number.isNaN(createdAt.getTime()) || !id ? undefined : { createdAt, id };
}

export default async function RecordsQueuePage({
  params,
  searchParams,
}: {
  params: Promise<{ agency: string }>;
  searchParams: Promise<{ tab?: string; before?: string }>;
}) {
  const [{ agency: slug }, sp] = await Promise.all([params, searchParams]);
  const agency = await getAgencyForSlug(slug);
  if (!agency || !agency.id) notFound();
  await requireStaff(slug); // coordinator/admin — the publication decision is theirs

  const tab: Tab = sp.tab === "published" ? "published" : sp.tab === "internal" ? "internal" : "undecided";
  const state: PublicationState =
    tab === "published" ? "published" : tab === "internal" ? "kept_internal" : "undecided";
  const before = parseCursor(sp.before);

  // Counts and pages come from the query layer — the queue never loads the
  // whole corpus to render three pills (a real archive is tens of thousands
  // of rows). +1 row detects whether a next page exists.
  const repo = await getRepository();
  const [counts, page, sources] = await Promise.all([
    repo.countPublicationStates(agency.id),
    repo.listPublicationDocuments(agency.id, state, { limit: PAGE_SIZE + 1, before }),
    repo.listSources(agency.id),
  ]);
  const sourceNames = new Map(sources.map((s) => [s.id, s.name]));
  const docs = page.slice(0, PAGE_SIZE);
  const lastRow = docs[docs.length - 1];
  const nextCursor =
    page.length > PAGE_SIZE && lastRow ? `${lastRow.createdAt.toISOString()}_${lastRow.id}` : null;

  // Decided tabs show the append-only trail per row (who did what, when, why).
  const historyByDoc = new Map<string, PublicationDecisionRow[]>();
  if (tab !== "undecided" && docs.length > 0) {
    const pageIds = new Set(docs.map((d) => d.id));
    for (const row of await repo.listPublicationDecisions(agency.id)) {
      if (!pageIds.has(row.documentId)) continue;
      const list = historyByDoc.get(row.documentId) ?? [];
      list.push(row);
      historyByDoc.set(row.documentId, list);
    }
  }
  const vms = docs.map((d) => toVM(d, sourceNames, historyByDoc.get(d.id)));

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "undecided", label: "Undecided", count: counts.undecided },
    { key: "published", label: "Published", count: counts.published },
    { key: "internal", label: "Kept internal", count: counts.kept_internal },
  ];

  return (
    <div className="wrap" style={{ maxWidth: 900, paddingBlock: "36px 48px" }}>
      <Link href={`/${slug}/app`} className="muted" style={{ fontSize: "0.9rem" }}>
        ← Command center
      </Link>
      <span className="eyebrow" style={{ display: "block", marginTop: 12 }}>
        {agency.name} · Records
      </span>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: "1.7rem", marginTop: 6, marginBottom: 6 }}>Publication queue</h1>
          <p className="muted" style={{ maxWidth: 620, marginBottom: 8 }}>
            Records piped in from your systems, waiting for the call: publish to the public archive
            (residents can find, download, and get answers from it) or keep internal (staff search
            only). Every decision is recorded under your name.
          </p>
        </div>
        <Link href={`/${slug}/app/admin/records-import`} className="btn btn-sm">
          Import records
        </Link>
      </div>

      <nav style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }} aria-label="Queue tabs">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/${slug}/app/records${t.key === "undecided" ? "" : `?tab=${t.key}`}`}
            className={`pill ${t.key === tab ? "pill-ai" : ""}`}
            style={{ textDecoration: "none" }}
          >
            {t.label} · {t.count}
          </Link>
        ))}
      </nav>

      <PublicationQueue
        key={`${tab}:${vms.map((v) => v.id).join(",")}`}
        agencySlug={slug}
        mode={tab}
        docs={vms}
      />

      {nextCursor && (
        <p style={{ marginTop: 14, textAlign: "center" }}>
          <Link
            className="btn btn-sm"
            href={`/${slug}/app/records?${new URLSearchParams({
              ...(tab === "undecided" ? {} : { tab }),
              before: nextCursor,
            }).toString()}`}
          >
            Load older records →
          </Link>
        </p>
      )}

      {tab === "internal" && vms.length > 0 && (
        <p className="muted" style={{ fontSize: "0.82rem", marginTop: 10 }}>
          Kept-internal records stay findable in{" "}
          <Link href={`/${slug}/app/search`}>staff records search</Link> and can still be published
          later from this tab.
        </p>
      )}
    </div>
  );
}
