import Link from "next/link";
import { notFound } from "next/navigation";
import { getOcrEngine, isOcrImageMime } from "@/adapters/ocr";
import { requireStaff } from "@/auth/guards";
import { getRepository } from "@/db/createRepository";
import { getRequestDetail } from "@/lib/live";
import { dateShort } from "@/lib/format";
import { EXEMPTION_OPTIONS, REDACTION_DEMO } from "@/lib/redactionDemo";
import { redactedArtifactExternalId } from "@/services/redactionService";
import { getStateProfile } from "@/statute/profiles";
import {
  RedactionStudio,
  type FinalizedArtifactVM,
  type ServerSuggestionVM,
} from "../../../../../../_components/RedactionStudio";

export const dynamic = "force-dynamic";

export default async function RedactPage({
  params,
  searchParams,
}: {
  params: Promise<{ agency: string; id: string }>;
  searchParams: Promise<{ doc?: string }>;
}) {
  const [{ agency: slug, id }, { doc: docParam }] = await Promise.all([params, searchParams]);
  const detail = await getRequestDetail(slug, id);
  if (!detail) notFound();
  const request = detail.request;

  // Live requests redact their real review-set documents; the demo fixture
  // keeps the sample so the studio is explorable on a fresh clone.
  let docs: { id: string; filename: string; hasText: boolean; scanLike: boolean }[] = [];
  const ocrEnabled = getOcrEngine().kind !== "disabled";
  let selected: { id: string; filename: string; lines: string[] } | null = null;
  let finalizedArtifact: FinalizedArtifactVM | null = null;
  let exemptions: string[] = [...EXEMPTION_OPTIONS];
  let serverSuggestions: ServerSuggestionVM[] = [];

  if (detail.source === "live") {
    const staff = await requireStaff(slug);
    const repo = await getRepository();
    const agency = await repo.getAgency(staff.agencyId);
    const profile = agency ? getStateProfile(agency.stateCode) : null;
    if (profile?.exemptions.length) {
      exemptions = profile.exemptions.map((e) => `${e.shortLabel} (${e.statuteSection})`);
    }

    const reviewSet = (await repo.listRequestDocuments(staff.agencyId, id)).filter(
      // The review set proper — not archive entries, not burned artifacts.
      (d) => d.classification === "internal" && !d.externalSystemId?.startsWith("redacted:"),
    );
    docs = reviewSet.map((d) => ({
      id: d.id,
      filename: d.filename ?? d.id,
      hasText: d.extractedText != null,
      // Scan-shaped bytes: an image file, or a PDF whose extraction found no
      // text layer — the documents OCR exists for.
      scanLike: isOcrImageMime(d.mimeType) || d.mimeType === "application/pdf",
    }));

    const pick =
      reviewSet.find((d) => d.id === docParam && d.extractedText != null) ??
      reviewSet.find((d) => d.extractedText != null);
    if (pick) {
      selected = { id: pick.id, filename: pick.filename ?? pick.id, lines: pick.extractedText!.split("\n") };
      // §6.5 step-2 suggestions the exemption-pass job stored at upload time.
      const stored = (pick.metadata as { aiSuggestions?: ServerSuggestionVM[] } | null)?.aiSuggestions;
      if (Array.isArray(stored)) serverSuggestions = stored;
      const artifact = await repo.findLatestDocumentByExternalId(
        staff.agencyId,
        redactedArtifactExternalId(pick.id),
      );
      if (artifact) {
        const log = (artifact.metadata as { exemptionLog?: unknown[] } | null)?.exemptionLog;
        finalizedArtifact = {
          filename: artifact.filename ?? "redacted.pdf",
          redactionCount: Array.isArray(log) ? log.length : 0,
          atLabel: dateShort(artifact.createdAt),
          lines: (artifact.extractedText ?? "").split("\n"),
        };
      }
    }
  }

  return (
    <div className="wrap" style={{ paddingBlock: "28px 8px" }}>
      <Link href={`/${slug}/app/requests/${id}`} className="muted" style={{ fontSize: "0.9rem" }}>
        ← {request.publicId}
      </Link>
      <h1 style={{ fontSize: "1.6rem", marginTop: 8, marginBottom: 4, fontWeight: 600 }}>
        Redaction studio
      </h1>
      <p className="muted" style={{ fontSize: "0.95rem", marginBottom: 16 }}>
        Black out lines or areas before release. Every redaction needs an exemption reason; the AI
        pre-flags likely PII but never redacts on its own.
      </p>

      {detail.source === "live" && docs.length > 1 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          {docs.map((d) =>
            d.hasText ? (
              <Link
                key={d.id}
                href={`/${slug}/app/requests/${id}/redact?doc=${d.id}`}
                className={`btn btn-sm${selected?.id === d.id ? " btn-primary" : ""}`}
              >
                {d.filename}
              </Link>
            ) : d.scanLike ? (
              // No text layer, but there are pixels — the visual studio's case.
              <Link
                key={d.id}
                href={`/${slug}/app/requests/${id}/redact-visual?doc=${d.id}`}
                className="btn btn-sm"
              >
                {d.filename} (visual studio →)
              </Link>
            ) : (
              <span key={d.id} className="btn btn-sm" style={{ opacity: 0.5, pointerEvents: "none" }}>
                {d.filename} (no text)
              </span>
            ),
          )}
        </div>
      )}

      {detail.source === "live" && !selected ? (
        <div className="card card-pad" style={{ maxWidth: 640 }}>
          <p style={{ margin: 0, fontWeight: 600 }}>
            {docs.length === 0
              ? "No documents in the review set yet."
              : "None of the submitted documents have an extractable text layer."}
          </p>
          <p className="muted" style={{ margin: "6px 0 0", fontSize: "0.92rem" }}>
            {docs.length === 0
              ? "Documents arrive here when a department submits records for this request."
              : docs.some((d) => d.scanLike)
                ? "These look like scans — redact them visually by drawing boxes on the page itself."
                : "A document we can't read can't be certified as redacted — withhold those documents or release them in full from the request page."}
          </p>
          {docs.some((d) => d.scanLike) && (
            <Link href={`/${slug}/app/requests/${id}/redact-visual`} className="btn btn-sm btn-primary" style={{ marginTop: 12 }}>
              Open the visual redaction studio →
            </Link>
          )}
        </div>
      ) : (
        <RedactionStudio
          key={selected ? `${selected.id}|${finalizedArtifact ? "done" : "open"}` : "demo"}
          documentName={selected?.filename ?? REDACTION_DEMO.documentName}
          requestPublicId={request.publicId}
          lines={selected?.lines ?? [...REDACTION_DEMO.lines]}
          exemptions={exemptions}
          live={
            detail.source === "live" && selected
              ? { agencySlug: slug, requestId: id, documentId: selected.id }
              : undefined
          }
          serverSuggestions={serverSuggestions}
          finalizedArtifact={finalizedArtifact}
        />
      )}
    </div>
  );
}
