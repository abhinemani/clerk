import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getArchiveRecord } from "@/lib/archive";
import { getAgencyForSlug } from "@/lib/live";
import { DownloadRecordButton } from "../../../_components/DownloadRecordButton";

export const dynamic = "force-dynamic";

/**
 * A public record's permalink (§6.7): every released record is a citable,
 * shareable URL — link it in a news story, a council packet, or an email.
 * Resolution is public-only in the data layer (invariant 3); anything else
 * 404s exactly like a record that never existed.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ agency: string; id: string }>;
}): Promise<Metadata> {
  const { agency: slug, id } = await params;
  const record = await getArchiveRecord(slug, id);
  return record
    ? { title: record.title, description: record.summary.slice(0, 160) || undefined }
    : {};
}

export default async function ArchiveRecordPage({
  params,
}: {
  params: Promise<{ agency: string; id: string }>;
}) {
  const { agency: slug, id } = await params;
  const [agency, record] = await Promise.all([getAgencyForSlug(slug), getArchiveRecord(slug, id)]);
  if (!agency || !record) notFound();

  const textLines = record.extractedText?.split("\n") ?? [];
  const PREVIEW_LINES = 400;

  return (
    <div className="wrap" style={{ paddingBlock: "40px", maxWidth: 820 }}>
      <Link href={`/${slug}/archive`} className="muted" style={{ fontSize: "0.9rem" }}>
        ← Public records archive
      </Link>

      <span className="eyebrow" style={{ display: "block", marginTop: 14 }}>
        {agency.name} · Released public record
      </span>
      <h1 className="serif" style={{ fontSize: "1.9rem", marginTop: 8, marginBottom: 10, fontWeight: 600 }}>
        {record.title}
      </h1>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <span className="tag">Released {record.date}</span>
        {record.recordType && <span className="tag">{record.recordType}</span>}
        {record.tags
          .filter((t) => t !== record.recordType)
          .map((t) => (
            <span key={t} className="tag">
              {t}
            </span>
          ))}
        {record.pageCount != null && <span className="tag">{record.pageCount} page{record.pageCount === 1 ? "" : "s"}</span>}
      </div>

      {record.summary && (
        <p style={{ fontSize: "1.05rem", marginTop: 16, maxWidth: 680 }}>{record.summary}</p>
      )}

      {record.sourceRequestPublicId && (
        <p className="muted" style={{ fontSize: "0.9rem", marginTop: 10 }}>
          Released in response to public records request{" "}
          <Link href={`/${slug}/track?id=${encodeURIComponent(record.sourceRequestPublicId)}`} className="mono">
            {record.sourceRequestPublicId}
          </Link>
          .
        </p>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 18, alignItems: "center", flexWrap: "wrap" }}>
        <DownloadRecordButton agencySlug={slug} documentId={record.id} href={record.downloadUrl} />
        {!record.downloadUrl && (
          <span className="muted" style={{ fontSize: "0.88rem" }}>
            Summary entry — no file is attached to this record.
          </span>
        )}
      </div>

      {textLines.length > 0 && (
        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: "1.05rem", marginBottom: 8 }}>
            Record text{" "}
            <span className="muted" style={{ fontWeight: 400, fontSize: "0.85rem" }}>
              · extracted rendition, searchable
            </span>
          </h2>
          <div
            className="card"
            style={{
              padding: "18px 20px",
              fontFamily: "var(--font-mono)",
              fontSize: "0.85rem",
              lineHeight: 1.55,
              whiteSpace: "pre-wrap",
              overflowX: "auto",
              color: "var(--ink-2)",
            }}
          >
            {textLines.slice(0, PREVIEW_LINES).join("\n")}
            {textLines.length > PREVIEW_LINES && (
              <p className="muted" style={{ marginTop: 12 }}>
                … {textLines.length - PREVIEW_LINES} more lines — download the record for the full
                document.
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
