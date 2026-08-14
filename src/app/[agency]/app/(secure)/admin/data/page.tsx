import Link from "next/link";
import { notFound } from "next/navigation";
import { connectedDropDir } from "@/adapters/dataSource";
import { requireStaff } from "@/auth/guards";
import { getRepository } from "@/db/createRepository";
import { getAgencyForSlug } from "@/lib/live";
import {
  connectedStampOf,
  describeSyncState,
  isConnectedSource,
  readSourceConfig,
} from "@/services/connectedSourceService";
import { ConnectedSourcesPanel, type ConnectedSourceRow, type DatasetRow } from "../../../../../_components/ConnectedSourcesPanel";
import { QuickUploadPanel } from "../../../../../_components/QuickUploadPanel";
import { RecordsImportPanel } from "../../../../../_components/RecordsImportPanel";
import { SourceManagerPanel, type SourceRow } from "../../../../../_components/SourceManagerPanel";

export const dynamic = "force-dynamic";

/**
 * Data & files — the one admin surface for everything that puts records into
 * the corpus: an ad-hoc drop of files with no spreadsheet, the CSV+ZIP bulk
 * pipe, and ongoing connected feeds (file drop, HTTP export, Socrata portal).
 * Source trust/policy sits at the bottom since it governs all three above it.
 *
 * Replaces two former pages (admin/sources, admin/records-import — both now
 * redirect here) that split this into three tabs' worth of navigation for
 * one underlying question: "where do our records come from, and what
 * happens when they arrive." Publishing decisions stay their own page
 * (/app/records) — reviewing what already landed is a different task from
 * adding more of it.
 */
export default async function DataAndFilesPage({ params }: { params: Promise<{ agency: string }> }) {
  const { agency: slug } = await params;
  const agency = await getAgencyForSlug(slug);
  if (!agency || !agency.id) notFound();
  await requireStaff(slug, ["admin"]);

  const repo = await getRepository();
  const allSources = await repo.listSources(agency.id);
  const docs = await repo.listDocuments(agency.id);

  const sourceRows: SourceRow[] = allSources.map((s) => ({
    id: s.id,
    name: s.name,
    type: s.type,
    hasKey: s.apiKeyHash != null,
    trust: s.trust,
    defaultClassification: s.defaultClassification,
  }));

  const connectedRows: ConnectedSourceRow[] = allSources.filter(isConnectedSource).map((s) => {
    const { connector, attestations } = readSourceConfig(s);
    const slices = docs
      .map((d) => ({ doc: d, stamp: connectedStampOf(d) }))
      .filter((x) => x.stamp != null && x.doc.sourceId === s.id);

    const byDataset = new Map<string, DatasetRow>();
    for (const { doc, stamp } of slices) {
      const name = stamp!.dataset;
      const row = byDataset.get(name) ?? {
        dataset: name,
        slices: 0,
        published: 0,
        quarantined: 0,
        latestPeriod: "",
        attestedBy: null,
        attestedAt: null,
      };
      row.slices++;
      if (doc.classification === "public") row.published++;
      if (stamp!.quarantined) row.quarantined++;
      if (stamp!.period > row.latestPeriod) row.latestPeriod = stamp!.period;
      byDataset.set(name, row);
    }
    for (const [name, row] of byDataset) {
      const a = attestations[name];
      row.attestedBy = a?.byName ?? null;
      row.attestedAt = a?.at ? a.at.slice(0, 10) : null;
    }

    return {
      id: s.id,
      name: s.name,
      kind: s.connectorKind ?? "dataset_file_drop",
      origin:
        connector.domain != null && connector.datasetId != null
          ? `${connector.domain}/${connector.datasetId}`
          : (connector.url ?? connectedDropDir(agency.id!)),
      paused: s.syncSchedule == null,
      syncState: describeSyncState(s),
      lastSyncAt: s.lastSyncAt ? s.lastSyncAt.toISOString().slice(0, 16).replace("T", " ") : null,
      datasets: [...byDataset.values()].sort((a, b) => a.dataset.localeCompare(b.dataset)),
    };
  });

  return (
    <div className="wrap" style={{ maxWidth: 880, paddingBlock: "36px 48px" }}>
      <Link href={`/${slug}/app/admin`} className="muted" style={{ fontSize: "0.9rem" }}>
        ← Administration
      </Link>
      <span className="eyebrow" style={{ display: "block", marginTop: 12 }}>
        {agency.name} · Administration
      </span>
      <h1 style={{ fontSize: "1.7rem", marginTop: 6, marginBottom: 6 }}>Data &amp; files</h1>
      <p className="muted" style={{ marginBottom: 24, maxWidth: 660 }}>
        Everything that puts records into the corpus, in one place. Drop files, pipe in a bulk
        export, or connect an ongoing feed — everything lands <strong>internal</strong> first;
        publishing is always a separate, named decision in the{" "}
        <Link href={`/${slug}/app/records`} style={{ fontWeight: 600 }}>
          records queue
        </Link>
        .
      </p>

      <h2 style={{ fontSize: "1.05rem", marginBottom: 4 }}>Quick upload</h2>
      <p className="muted" style={{ fontSize: "0.88rem", marginBottom: 12, maxWidth: 620 }}>
        Have a folder of files and no spreadsheet? Drop them here.
      </p>
      <QuickUploadPanel agencySlug={slug} />

      <h2 style={{ fontSize: "1.05rem", marginTop: 34, marginBottom: 4 }}>Bulk import</h2>
      <p className="muted" style={{ fontSize: "0.88rem", marginBottom: 12, maxWidth: 620 }}>
        A CSV inventory (dates, tags, record types), optionally with a ZIP of the files themselves.
        Use this when the metadata matters at import time — the quick upload above always leaves it
        for auto-classification instead.
      </p>
      <RecordsImportPanel agencySlug={slug} />

      <h2 style={{ fontSize: "1.05rem", marginTop: 34, marginBottom: 4 }}>Connected data feeds</h2>
      <p className="muted" style={{ fontSize: "0.88rem", marginBottom: 12, maxWidth: 660 }}>
        Data your city already publishes — sweeping schedules, permit logs, an open-data portal —
        synced on a schedule so residents get answers from it without filing a request. Put a
        dataset on standing publication once you trust the feed; new periods then publish
        themselves.
      </p>
      <ConnectedSourcesPanel agencySlug={slug} sources={connectedRows} dropDir={connectedDropDir(agency.id)} />

      <h2 style={{ fontSize: "1.05rem", marginTop: 34, marginBottom: 4 }}>Source policy</h2>
      <p className="muted" style={{ fontSize: "0.88rem", marginBottom: 12, maxWidth: 620 }}>
        What happens to records as they arrive from each source above — held for review (the safe
        default) or published automatically — plus ingestion-API key rotation. Policy changes are
        audited.
      </p>
      <SourceManagerPanel agencySlug={slug} sources={sourceRows} />

      <p className="muted" style={{ fontSize: "0.82rem", marginTop: 18, maxWidth: 620 }}>
        Systems can also push records directly:{" "}
        <span className="mono">POST /api/v1/{slug}/records</span> with a source&apos;s{" "}
        <span className="mono">ck_</span> key as a Bearer token.
      </p>
    </div>
  );
}
