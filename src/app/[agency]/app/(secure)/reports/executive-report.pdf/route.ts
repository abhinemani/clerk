/**
 * Executive report as a typeset PDF (docs/executive-reporting.md) — the
 * period-windowed artifact a clerk hands to a city manager or council. The
 * clerk picks the window (day / week / month + a date inside it) and which
 * sections to include; the route composes loader → pure summary → pure
 * renderer, the same shape as the annual-report route.
 *
 * Coordinator-surface posture: requireStaff with no roles list, so
 * responders are redirected to their task queue (guards.ts default-deny).
 */
import { requireStaff } from "@/auth/guards";
import { getAgencyForSlug } from "@/lib/live";
import { liveExecutiveDataset } from "@/lib/reportingData";
import { computeExecutiveSummary, type ReportPeriodKind } from "@/reporting/executiveSummary";
import { ALL_SECTION_IDS, renderExecutiveReportPdf } from "@/reporting/executiveReportPdf";

export const runtime = "nodejs";

const KINDS: ReportPeriodKind[] = ["day", "week", "month"];
const MAX_NOTE_LENGTH = 600;

export async function GET(req: Request, { params }: { params: Promise<{ agency: string }> }) {
  const { agency: slug } = await params;
  const staff = await requireStaff(slug);

  const agency = await getAgencyForSlug(slug);
  if (!agency || !agency.id) return new Response("Not found", { status: 404 });

  const url = new URL(req.url);
  const kindParam = url.searchParams.get("period") ?? "week";
  const kind: ReportPeriodKind = (KINDS as string[]).includes(kindParam)
    ? (kindParam as ReportPeriodKind)
    : "week";

  // Any date inside the desired window; the summary snaps it to the enclosing
  // day/week/month. Parsed at UTC noon so the calendar date can't slip a day.
  let ref = new Date();
  const dateParam = url.searchParams.get("date");
  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    const parsed = new Date(`${dateParam}T12:00:00Z`);
    if (!Number.isNaN(parsed.getTime())) ref = parsed;
  }

  const sectionsParam = url.searchParams.get("sections");
  const requested = sectionsParam
    ? sectionsParam.split(",").filter((s) => (ALL_SECTION_IDS as string[]).includes(s))
    : ALL_SECTION_IDS;
  const sections = requested.length > 0 ? requested : ALL_SECTION_IDS;

  const note = (url.searchParams.get("note") ?? "").slice(0, MAX_NOTE_LENGTH);

  const dataset = await liveExecutiveDataset(agency.id);
  const summary = computeExecutiveSummary(dataset, kind, ref);
  const pdf = renderExecutiveReportPdf(summary, {
    agencyName: agency.name,
    sections,
    note,
    statuteReview: agency.settings?.statuteReview ?? null,
    generatedAt: new Date(),
    preparedBy: staff.name,
  });

  const stamp = summary.period.start.toISOString().slice(0, 10);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${slug}-executive-report-${kind}-${stamp}.pdf"`,
      "content-length": String(pdf.length),
    },
  });
}
