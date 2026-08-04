/**
 * Per-request defensibility bundle as a real PDF (spec §10: "exportable per
 * request — the defensibility report for litigation"). Renders the
 * append-only audit trail with real staff names, via the same
 * dependency-free PDF writer that produces redacted release artifacts.
 */
import { requireStaff } from "@/auth/guards";
import { getRepository } from "@/db/createRepository";
import { renderTextPdf } from "@/domain/textPdf";
import { buildDefensibilityReport, renderAuditText } from "@/reporting/auditExport";

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

  const [events, users] = await Promise.all([
    repo.listEvents(staff.agencyId, id),
    repo.listUsers(staff.agencyId),
  ]);
  const actorNameById = new Map(users.map((u) => [u.id, u.name ?? u.email]));

  const report = buildDefensibilityReport({
    agencyName: agency.name,
    request: {
      publicId: request.publicId,
      rawText: request.rawText,
      status: request.status,
      receivedAt: request.receivedAt,
      statutoryDueAt: request.statutoryDueAt,
    },
    events,
    actorNameById,
  });
  const pdf = renderTextPdf(renderAuditText(report).split("\n"), "Defensibility report");

  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${request.publicId}-defensibility-report.pdf"`,
      "content-length": String(pdf.length),
    },
  });
}
