/**
 * Annual compliance report as a real PDF (roadmap: "ship the artifacts
 * counsel actually asks for" — not just on-screen numbers). Same
 * ComplianceReport the dashboard and CSV export compute, rendered as text
 * (renderComplianceNarrative) and turned into a PDF with the same
 * dependency-free renderer that produces redacted release artifacts.
 */
import { requireStaff } from "@/auth/guards";
import { renderTextPdf } from "@/domain/textPdf";
import { getAgencyForSlug } from "@/lib/live";
import { liveComplianceDataset } from "@/lib/reportingData";
import { complianceReport } from "@/reporting/metrics";
import { renderComplianceNarrative } from "@/reporting/annualReport";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ agency: string }> }) {
  const { agency: slug } = await params;
  await requireStaff(slug); // any staff role may pull the report

  const agency = await getAgencyForSlug(slug);
  if (!agency || !agency.id) return new Response("Not found", { status: 404 });

  const { records, deflections } = await liveComplianceDataset(agency.id);
  const report = complianceReport(records, deflections);
  const now = new Date();
  const narrative = renderComplianceNarrative(
    report,
    agency.name,
    `Through ${now.toISOString().slice(0, 10)}`,
    { statuteReview: agency.settings?.statuteReview ?? null },
  );
  const pdf = renderTextPdf(narrative.split("\n"), "Annual compliance report");

  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${slug}-compliance-report-${now.toISOString().slice(0, 10)}.pdf"`,
      "content-length": String(pdf.length),
    },
  });
}
