/**
 * Production index (Vaughn-style index of records) as a PDF — the per-document
 * account of the production: decision, exemption, decider, redaction reasons,
 * and the checksummed release each document went out in. A projection of
 * records the platform already keeps (§5 reviews, redaction exemption logs,
 * invariant 8 releases), rendered by the same dependency-free PDF writer as
 * the defensibility report.
 */
import { requireStaff } from "@/auth/guards";
import { getRepository } from "@/db/createRepository";
import { renderTextPdf } from "@/domain/textPdf";
import { buildProductionIndex, renderProductionIndexText } from "@/reporting/productionIndex";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ agency: string; id: string }> },
) {
  const { agency: slug, id } = await params;
  const staff = await requireStaff(slug);

  const repo = await getRepository();
  const [agency, request] = await Promise.all([
    repo.getAgency(staff.agencyId),
    repo.getRequest(staff.agencyId, id),
  ]);
  if (!agency || !request) return new Response("Not found", { status: 404 });

  const [reviews, documents, releases, users, allDocuments] = await Promise.all([
    repo.listReviews(staff.agencyId, id),
    repo.listRequestDocuments(staff.agencyId, id),
    repo.listReleases(staff.agencyId, id),
    repo.listUsers(staff.agencyId),
    repo.listDocuments(staff.agencyId),
  ]);

  const index = buildProductionIndex({
    agencyName: agency.name,
    request,
    reviews,
    documents,
    // finalizeRedaction mints "redacted:<sourceDocId>" artifacts whose
    // metadata carries the exemption log (reasons + positions, never content).
    redactionArtifacts: allDocuments.filter((d) => d.externalSystemId?.startsWith("redacted:")),
    releases,
    actorNameById: new Map(users.map((u) => [u.id, u.name ?? u.email])),
    now: new Date(),
  });

  const pdf = renderTextPdf(renderProductionIndexText(index).split("\n"), "Production index");

  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${request.publicId}-production-index.pdf"`,
      "content-length": String(pdf.length),
    },
  });
}
