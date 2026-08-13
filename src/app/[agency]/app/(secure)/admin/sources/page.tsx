import Link from "next/link";
import { notFound } from "next/navigation";
import { connectedDropDir } from "@/adapters/dataSource";
import { requireStaff } from "@/auth/guards";
import { getRepository } from "@/db/createRepository";
import { getAgencyForSlug } from "@/lib/live";
import { connectedStampOf, describeSyncState, isConnectedSource } from "@/services/connectedSourceService";
import { ConnectedSourcesPanel, type ConnectedSourceRow } from "../../../../../_components/ConnectedSourcesPanel";

export const dynamic = "force-dynamic";

/**
 * Connected data sources (docs/connected-sources.md phase 1) — a source is
 * an ongoing relationship (sync state, future attestations), so it gets its
 * own page rather than a bolt-on to the one-off records importer.
 */
export default async function ConnectedSourcesPage({ params }: { params: Promise<{ agency: string }> }) {
  const { agency: slug } = await params;
  const agency = await getAgencyForSlug(slug);
  if (!agency || !agency.id) notFound();
  await requireStaff(slug, ["admin"]);

  const repo = await getRepository();
  const sources = (await repo.listSources(agency.id)).filter(isConnectedSource);

  // Per-source slice/dataset tallies from the corpus itself.
  const docs = await repo.listDocuments(agency.id);
  const rows: ConnectedSourceRow[] = sources.map((s) => {
    const slices = docs.filter((d) => d.sourceId === s.id && connectedStampOf(d) != null);
    const datasets = new Set(slices.map((d) => connectedStampOf(d)!.dataset));
    return {
      id: s.id,
      name: s.name,
      paused: s.syncSchedule == null,
      syncState: describeSyncState(s),
      lastSyncAt: s.lastSyncAt ? s.lastSyncAt.toISOString().slice(0, 16).replace("T", " ") : null,
      datasetCount: datasets.size,
      sliceCount: slices.length,
    };
  });

  return (
    <div className="wrap" style={{ maxWidth: 820, paddingBlock: "36px 48px" }}>
      <Link href={`/${slug}/app/admin`} className="muted" style={{ fontSize: "0.9rem" }}>
        ← Administration
      </Link>
      <span className="eyebrow" style={{ display: "block", marginTop: 12 }}>
        {agency.name} · Administration
      </span>
      <h1 style={{ fontSize: "1.7rem", marginTop: 6, marginBottom: 6 }}>Connected data sources</h1>
      <p className="muted" style={{ marginBottom: 20, maxWidth: 640 }}>
        Data your city already publishes — sweeping schedules, permit logs, budget extracts —
        synced in on a schedule so residents get answers from it without filing a request. Synced
        records wait in the{" "}
        <Link href={`/${slug}/app/records`} style={{ fontWeight: 600 }}>
          records queue
        </Link>{" "}
        like any other import; publishing stays a named decision. One-off imports live at{" "}
        <Link href={`/${slug}/app/admin/records-import`} style={{ fontWeight: 600 }}>
          Import records
        </Link>
        .
      </p>
      <ConnectedSourcesPanel agencySlug={slug} sources={rows} dropDir={connectedDropDir(agency.id)} />
    </div>
  );
}
