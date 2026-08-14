import Link from "next/link";
import { notFound } from "next/navigation";
import { listArchive } from "@/lib/archive";
import { getAgencyForSlug } from "@/lib/live";
import { AnswerBox } from "../../_components/AnswerBox";
import { ConnectedDataTag } from "../../_components/ConnectedDataBadge";
import { DownloadRecordButton } from "../../_components/DownloadRecordButton";

export const dynamic = "force-dynamic";

/**
 * The public archive — the deflection engine's storefront. The same
 * ask-anything box as the portal home sits on top (search, cited answers,
 * prior-answer matches, and the file-a-request fallback), so this page can
 * answer questions, not just list cards.
 */
export default async function ArchivePage({ params }: { params: Promise<{ agency: string }> }) {
  const { agency: slug } = await params;
  const agency = await getAgencyForSlug(slug);
  if (!agency) notFound();
  const releases = await listArchive(slug);

  return (
    <>
      <div className="civic-hero">
        <div className="wrap" style={{ paddingBlock: "var(--page-top) 30px" }}>
          <Link href={`/${agency.slug}`} className="muted" style={{ fontSize: "0.9rem" }}>
            ← Back to portal
          </Link>
          <span className="eyebrow" style={{ display: "block", marginTop: 14 }}>
            {agency.name} · Public Records
          </span>
          <h1 style={{ fontSize: "2rem", marginTop: 8, marginBottom: 6, fontWeight: 600 }}>
            Public records archive
          </h1>
          <p className="muted" style={{ fontSize: "1.02rem", marginBottom: 18, maxWidth: 620 }}>
            Records already released to the public — free to download, no request needed. Ask a
            question and the archive answers with citations.
          </p>
          <div style={{ maxWidth: 720 }}>
            <AnswerBox agencySlug={agency.slug} aiEnabled={Boolean(process.env.ANTHROPIC_API_KEY)} />
          </div>
        </div>
      </div>

      <div className="wrap" style={{ paddingBlock: "var(--page-top-snug) var(--page-bottom)" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
            gap: 16,
          }}
        >
          {releases.map((r) => (
            <article
              key={r.id}
              className="card card-pad hover-lift"
              style={{ display: "flex", flexDirection: "column" }}
            >
              <h2 style={{ fontSize: "1.08rem" }}>
                <Link href={`/${agency.slug}/archive/${r.id}`} style={{ color: "var(--ink)" }}>
                  {r.title}
                </Link>
              </h2>
              <p className="muted" style={{ fontSize: "0.9rem", marginTop: 6 }}>
                {r.summary}
              </p>
              <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                {r.connectedSource ? (
                  <ConnectedDataTag stamp={r.connectedSource} />
                ) : (
                  <span className="tag">Released {r.date}</span>
                )}
                {r.tags.slice(0, 3).map((t) => (
                  <span key={t} className="tag">
                    {t}
                  </span>
                ))}
              </div>
              {/* Actions pinned to the card foot so every card in a row aligns.
                  ONE primary action: the file when there is one, else the record. */}
              <div
                style={{ display: "flex", gap: 8, alignItems: "center", marginTop: "auto", paddingTop: 14 }}
              >
                {r.downloadUrl ? (
                  <>
                    <DownloadRecordButton agencySlug={agency.slug} documentId={r.id} href={r.downloadUrl} />
                    <Link href={`/${agency.slug}/archive/${r.id}`} className="btn btn-sm btn-ghost">
                      Details
                    </Link>
                  </>
                ) : (
                  <Link href={`/${agency.slug}/archive/${r.id}`} className="btn btn-sm">
                    View record →
                  </Link>
                )}
                <span className="muted" style={{ marginLeft: "auto", fontSize: "0.72rem" }}>
                  ✦ AI summary
                </span>
              </div>
            </article>
          ))}
          {releases.length === 0 && (
            <div className="card card-pad" style={{ gridColumn: "1 / -1" }}>
              <p style={{ margin: 0, fontWeight: 600 }}>Nothing published yet.</p>
              <p className="muted" style={{ margin: "6px 0 0", fontSize: "0.92rem" }}>
                Released records appear here the moment staff publish them. If you&apos;re looking
                for something specific,{" "}
                <Link href={`/${agency.slug}/request`} style={{ fontWeight: 600 }}>
                  file a request
                </Link>{" "}
                — it takes about two minutes.
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
