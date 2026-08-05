import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepository } from "@/db/createRepository";
import { getAgencyForSlug } from "@/lib/live";
import { requireStaff } from "@/auth/guards";
import { RecordsImportPanel } from "../../../../../_components/RecordsImportPanel";
import { SourceManagerPanel, type SourceRow } from "../../../../../_components/SourceManagerPanel";

export const dynamic = "force-dynamic";

export default async function RecordsImportPage({ params }: { params: Promise<{ agency: string }> }) {
  const { agency: slug } = await params;
  const agency = await getAgencyForSlug(slug);
  if (!agency || !agency.id) notFound();
  await requireStaff(slug, ["admin"]);

  const repo = await getRepository();
  const sources = await repo.listSources(agency.id);
  const sourceRows: SourceRow[] = sources.map((s) => ({
    id: s.id,
    name: s.name,
    type: s.type,
    hasKey: s.apiKeyHash != null,
    trust: s.trust,
    defaultClassification: s.defaultClassification,
  }));

  return (
    <div className="wrap" style={{ maxWidth: 820, paddingBlock: "36px 48px" }}>
      <Link href={`/${slug}/app/admin`} className="muted" style={{ fontSize: "0.9rem" }}>
        ← Administration
      </Link>
      <span className="eyebrow" style={{ display: "block", marginTop: 12 }}>
        {agency.name} · Administration
      </span>
      <h1 style={{ fontSize: "1.7rem", marginTop: 6, marginBottom: 6 }}>Import records</h1>
      <p className="muted" style={{ marginBottom: 20, maxWidth: 620 }}>
        Pipe records in from your existing systems — CSV exports, with or without the files. Imports
        land in the{" "}
        <Link href={`/${slug}/app/records`} style={{ fontWeight: 600 }}>
          records queue
        </Link>{" "}
        as internal; publishing is a separate, named decision.
      </p>
      <RecordsImportPanel agencySlug={slug} />

      <h2 style={{ fontSize: "1.1rem", marginTop: 30, marginBottom: 8 }}>Connected sources</h2>
      <p className="muted" style={{ fontSize: "0.9rem", marginBottom: 12, maxWidth: 620 }}>
        Where records come from, and what happens when they arrive. New sources hold everything for
        review; switch a source to auto-publish only when your office already vets that feed. Key
        rotation and policy changes are audited.
      </p>
      <SourceManagerPanel agencySlug={slug} sources={sourceRows} />

      <p className="muted" style={{ fontSize: "0.82rem", marginTop: 14, maxWidth: 620 }}>
        Systems can also push records directly:{" "}
        <span className="mono">POST /api/v1/{slug}/records</span> with the source&apos;s{" "}
        <span className="mono">ck_</span> key as a Bearer token.
      </p>
    </div>
  );
}
