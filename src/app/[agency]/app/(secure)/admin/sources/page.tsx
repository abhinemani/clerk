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
import {
  ConnectedSourcesPanel,
  type ConnectedSourceRow,
  type DatasetRow,
} from "../../../../../_components/ConnectedSourcesPanel";

export const dynamic = "force-dynamic";

/**
 * Connected data sources (docs/connected-sources.md) — a source is an
 * ongoing relationship (sync state, standing attestations), so it gets its
 * own page rather than a bolt-on to the one-off records importer.
 */
export default async function ConnectedSourcesPage({ params }: { params: Promise<{ agency: string }> }) {
  const { agency: slug } = await params;
  const agency = await getAgencyForSlug(slug);
  if (!agency || !agency.id) notFound();
  await requireStaff(slug, ["admin"]);

  const repo = await getRepository();
  const sources = (await repo.listSources(agency.id)).filter(isConnectedSource);
  const docs = await repo.listDocuments(agency.id);

  const rows: ConnectedSourceRow[] = sources.map((s) => {
    const { connector, attestations } = readSourceConfig(s);
    const slices = docs
      .map((d) => ({ doc: d, stamp: connectedStampOf(d) }))
      .filter((x) => x.stamp != null && x.doc.sourceId === s.id);

    // One row per dataset: how much has landed, how much is public, and
    // whether a human put it on standing publication.
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
    <div className="wrap" style={{ maxWidth: 860, paddingBlock: "36px 48px" }}>
      <Link href={`/${slug}/app/admin`} className="muted" style={{ fontSize: "0.9rem" }}>
        ← Administration
      </Link>
      <span className="eyebrow" style={{ display: "block", marginTop: 12 }}>
        {agency.name} · Administration
      </span>
      <h1 style={{ fontSize: "1.7rem", marginTop: 6, marginBottom: 6 }}>Connected data sources</h1>
      <p className="muted" style={{ marginBottom: 20, maxWidth: 660 }}>
        Data your city already publishes — sweeping schedules, permit logs, budget extracts —
        synced in on a schedule so residents get answers from it without filing a request. Synced
        records wait in the{" "}
        <Link href={`/${slug}/app/records`} style={{ fontWeight: 600 }}>
          records queue
        </Link>{" "}
        for review, unless you put a dataset on standing publication. One-off imports live at{" "}
        <Link href={`/${slug}/app/admin/records-import`} style={{ fontWeight: 600 }}>
          Import records
        </Link>
        .
      </p>
      <ConnectedSourcesPanel
        agencySlug={slug}
        sources={rows}
        dropDir={connectedDropDir(agency.id)}
      />
    </div>
  );
}
