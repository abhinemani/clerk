import Link from "next/link";
import { notFound } from "next/navigation";
import { getBlobStore } from "@/adapters/blobStore";
import { requireStaff } from "@/auth/guards";
import { getRepository } from "@/db/createRepository";
import { readDocumentMeta } from "@/domain/documentMeta";
import { dateShort } from "@/lib/format";
import { getRequestDetail } from "@/lib/live";
import { EXEMPTION_OPTIONS } from "@/lib/redactionDemo";
import { redactedArtifactExternalId } from "@/services/redactionService";
import { documentPageImages } from "@/services/visualRedactionService";
import { getStateProfile } from "@/statute/profiles";
import {
  VisualRedactionStudio,
  type VisualFinalizedVM,
} from "../../../../../../_components/VisualRedactionStudio";

export const dynamic = "force-dynamic";

/**
 * Visual redaction studio — for scans, photos, and PDFs with no usable text
 * layer: the documents the TEXT studio can only withhold. Staff draw boxes
 * on the rendered page; finalize burns the pixels server-side.
 */
export default async function VisualRedactPage({
  params,
  searchParams,
}: {
  params: Promise<{ agency: string; id: string }>;
  searchParams: Promise<{ doc?: string }>;
}) {
  const [{ agency: slug, id }, { doc: docParam }] = await Promise.all([params, searchParams]);
  const detail = await getRequestDetail(slug, id);
  if (!detail || detail.source !== "live") notFound(); // live review sets only
  const staff = await requireStaff(slug);

  const repo = await getRepository();
  const agency = await repo.getAgency(staff.agencyId);
  const profile = agency ? getStateProfile(agency.stateCode) : null;
  const exemptions = profile?.exemptions.length
    ? profile.exemptions.map((e) => `${e.shortLabel} (${e.statuteSection})`)
    : [...EXEMPTION_OPTIONS];

  // Image-backed candidates: uploads with stored bytes that are images or
  // PDFs (a text-born PDF resolves to zero pages below and says so).
  const reviewSet = (await repo.listRequestDocuments(staff.agencyId, id)).filter(
    (d) => d.classification === "internal" && !d.externalSystemId?.startsWith("redacted:"),
  );
  const candidates = reviewSet.filter(
    (d) => d.blobRef && (d.mimeType?.startsWith("image/") || d.mimeType === "application/pdf"),
  );

  const selected = candidates.find((d) => d.id === docParam) ?? candidates[0] ?? null;
  let pageCount = 0;
  let finalized: VisualFinalizedVM | null = null;
  if (selected) {
    const blob = await getBlobStore().get(selected.blobRef!);
    if (blob) pageCount = documentPageImages(blob.bytes, selected.mimeType ?? blob.contentType ?? null).length;
    const artifact = await repo.findLatestDocumentByExternalId(
      staff.agencyId,
      redactedArtifactExternalId(selected.id),
    );
    if (artifact && readDocumentMeta(artifact).redactionMode === "visual") {
      const log = (artifact.metadata as { exemptionLog?: unknown[] } | null)?.exemptionLog;
      finalized = {
        filename: artifact.filename ?? "redacted.pdf",
        redactionCount: Array.isArray(log) ? log.length : 0,
        pageCount: artifact.pageCount ?? 1,
        atLabel: dateShort(artifact.createdAt),
        artifactUrl: `/${slug}/files/${artifact.id}`,
      };
    }
  }

  return (
    <div className="wrap" style={{ paddingBlock: "28px 24px" }}>
      <Link href={`/${slug}/app/requests/${id}`} className="muted" style={{ fontSize: "0.9rem" }}>
        ← {detail.request.publicId}
      </Link>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: "1.6rem", marginTop: 8, marginBottom: 4, fontWeight: 600 }}>
          Visual redaction
        </h1>
        <Link href={`/${slug}/app/requests/${id}/redact`} className="muted" style={{ fontSize: "0.88rem" }}>
          Text studio →
        </Link>
      </div>
      <p className="muted" style={{ fontSize: "0.95rem", marginBottom: 16, maxWidth: 640 }}>
        For scans, photos, and PDFs without a text layer. Draw boxes over what must not be
        released; finalizing destroys those pixels in a regenerated, image-only release copy.
      </p>

      {candidates.length > 1 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          {candidates.map((d) => (
            <Link
              key={d.id}
              href={`/${slug}/app/requests/${id}/redact-visual?doc=${d.id}`}
              className={`btn btn-sm${selected?.id === d.id ? " btn-primary" : ""}`}
            >
              {d.filename ?? d.id}
            </Link>
          ))}
        </div>
      )}

      {!selected ? (
        <div className="card card-pad" style={{ maxWidth: 640 }}>
          <p style={{ margin: 0, fontWeight: 600 }}>No image-backed documents in the review set.</p>
          <p className="muted" style={{ margin: "6px 0 0", fontSize: "0.92rem" }}>
            Documents with an extractable text layer are redacted in the{" "}
            <Link href={`/${slug}/app/requests/${id}/redact`}>text studio</Link>.
          </p>
        </div>
      ) : pageCount === 0 ? (
        <div className="card card-pad" style={{ maxWidth: 640 }}>
          <p style={{ margin: 0, fontWeight: 600 }}>
            {selected.filename ?? selected.id} has no extractable page images.
          </p>
          <p className="muted" style={{ margin: "6px 0 0", fontSize: "0.92rem" }}>
            This looks like a text-born PDF — use the{" "}
            <Link href={`/${slug}/app/requests/${id}/redact?doc=${selected.id}`}>text studio</Link>{" "}
            instead, where redactions burn character-precisely.
          </p>
        </div>
      ) : (
        <VisualRedactionStudio
          key={`${selected.id}|${finalized ? "done" : "open"}`}
          agencySlug={slug}
          requestId={id}
          documentId={selected.id}
          documentName={selected.filename ?? selected.id}
          pageCount={pageCount}
          exemptions={exemptions}
          finalized={finalized}
        />
      )}
    </div>
  );
}
