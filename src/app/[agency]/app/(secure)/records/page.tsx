import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepository } from "@/db/createRepository";
import { getAgencyForSlug } from "@/lib/live";
import { requireStaff } from "@/auth/guards";
import { listPublicationQueues } from "@/services/publicationService";
import type { DocumentEntity } from "@/services/repository";
import { PublicationQueue, type QueueDocVM } from "../../../../_components/PublicationQueue";

export const dynamic = "force-dynamic";

type Tab = "undecided" | "published" | "internal";

function toVM(d: DocumentEntity, sourceNames: Map<string, string>): QueueDocVM {
  const meta = (d.metadata ?? {}) as {
    title?: string;
    summary?: string;
    tags?: string[];
    keywords?: string[];
    recordDate?: string;
    releasedOn?: string;
    aiClassification?: {
      suggestedClassification?: "public" | "internal";
      recordType?: string;
      sensitivityNote?: string | null;
    };
    publicationDecision?: { decision: string; byName: string; at: string };
  };
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
  };
}

export default async function RecordsQueuePage({
  params,
  searchParams,
}: {
  params: Promise<{ agency: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ agency: slug }, sp] = await Promise.all([params, searchParams]);
  const agency = await getAgencyForSlug(slug);
  if (!agency || !agency.id) notFound();
  await requireStaff(slug); // coordinator/admin — the publication decision is theirs

  const repo = await getRepository();
  const [queues, sources] = await Promise.all([
    listPublicationQueues({ repo, now: () => new Date(), genId: () => crypto.randomUUID(), genToken: () => "" }, agency.id),
    repo.listSources(agency.id),
  ]);
  const sourceNames = new Map(sources.map((s) => [s.id, s.name]));

  const tab: Tab = sp.tab === "published" ? "published" : sp.tab === "internal" ? "internal" : "undecided";
  const docs = tab === "undecided" ? queues.undecided : tab === "published" ? queues.published : queues.keptInternal;
  const vms = docs.map((d) => toVM(d, sourceNames));

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "undecided", label: "Undecided", count: queues.undecided.length },
    { key: "published", label: "Published", count: queues.published.length },
    { key: "internal", label: "Kept internal", count: queues.keptInternal.length },
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
