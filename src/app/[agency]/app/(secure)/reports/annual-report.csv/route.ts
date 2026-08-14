/**
 * Annual compliance report as a spreadsheet — the CSV companion for states
 * whose AG wants rows, not prose. Same liveComplianceDataset the PDF and the
 * on-screen report compute from, so the three artifacts can never disagree.
 */
import { requireStaff } from "@/auth/guards";
import { getAgencyForSlug } from "@/lib/live";
import { liveComplianceDataset } from "@/lib/reportingData";
import { complianceReport } from "@/reporting/metrics";
import { complianceReportCsv } from "@/reporting/csv";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ agency: string }> }) {
  const { agency: slug } = await params;
  await requireStaff(slug);

  const agency = await getAgencyForSlug(slug);
  if (!agency || !agency.id) return new Response("Not found", { status: 404 });

  const { records, deflections } = await liveComplianceDataset(agency.id);
  const report = complianceReport(records, deflections);
  const now = new Date();
  const csv = complianceReportCsv(report, {
    agencyName: agency.name,
    periodLabel: `Through ${now.toISOString().slice(0, 10)}`,
    statuteReview: agency.settings?.statuteReview ?? null,
  });

  const body = new TextEncoder().encode(csv);
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${slug}-compliance-report-${now.toISOString().slice(0, 10)}.csv"`,
      "content-length": String(body.length),
    },
  });
}
