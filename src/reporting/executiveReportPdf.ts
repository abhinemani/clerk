/**
 * Executive report PDF — the typeset artifact a clerk hands to a city
 * manager or council (docs/executive-reporting.md). Pure rendering of an
 * ExecutiveSummary through the styled PDF engine; the route composes
 * loader → computeExecutiveSummary → this.
 *
 * Palette is the brand's LIGHT (print/official-document) palette, hardcoded
 * here because a PDF has no CSS tokens to inherit: paper ground, ink text,
 * gold as ornament only (never text on the light ground — brand rule),
 * functional status colors for on-time/overdue, AI teal for deflections.
 */
import { PAGE_W, StyledPdf, rgb, type Rgb } from "./styledPdf";
import { EXECUTIVE_SECTIONS, type ExecutiveSummary, type ExecutiveKpis } from "./executiveSummary";

export { ALL_SECTION_IDS, EXECUTIVE_SECTIONS, type ExecutiveSectionId } from "./executiveSummary";

const PAPER = rgb("#f7f7f5");
const PLATE = rgb("#ffffff");
const INK = rgb("#0f141a");
const SLATE = rgb("#2a313c");
const MUTED = rgb("#5c6572");
const HAIRLINE = rgb("#d9d9d3");
const TRACK = rgb("#e8e8e3");
const GOLD = rgb("#f5c75e");
const TERRACOTTA = rgb("#9c4a2c");
const TEAL = rgb("#0e6b84");
const OK = rgb("#067647");
const DUE = rgb("#b54708");
const OVERDUE = rgb("#b42318");

export interface ExecutiveReportOptions {
  agencyName: string;
  /** Which sections to render, in catalog order. Unknown ids are ignored. */
  sections: readonly string[];
  /** Clerk-written framing note, printed under the header. */
  note?: string;
  statuteReview?: { reviewedBy: string; reviewedOn: string } | null;
  generatedAt: Date;
  preparedBy?: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  fulfilled: "Fulfilled",
  partially_fulfilled: "Partially fulfilled",
  denied: "Denied",
  referred: "Referred",
  withdrawn: "Withdrawn",
  closed: "Closed",
};

const pct = (n: number) => `${Math.round(n * 100)}%`;

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function renderExecutiveReportPdf(summary: ExecutiveSummary, opts: ExecutiveReportOptions): Buffer {
  const title = `${opts.agencyName} — Executive report — ${summary.period.label}`;
  const chosen = new Set(opts.sections);

  const pdf = new StyledPdf({
    title,
    background: PAPER,
    marginBottom: 64,
    footer: (p, { page, pageCount }) => {
      const y = 792 - 40;
      p.line(p.marginX, y, PAGE_W - p.marginX, y, HAIRLINE, 0.6);
      p.drawTextAt(p.marginX, y + 12, `${opts.agencyName} · Executive report · ${summary.period.label}`, {
        size: 7,
        color: MUTED,
      });
      const pageText = `Page ${page} of ${pageCount}`;
      p.drawTextAt(PAGE_W - p.marginX - p.widthOf(pageText, "regular", 7), y + 12, pageText, {
        size: 7,
        color: MUTED,
      });
    },
    onPageBreak: (p) => {
      // Running header on continuation pages: slim ink band, no full masthead.
      p.fillRect(0, 0, PAGE_W, 26, INK);
      p.drawTextAt(p.marginX, 17, opts.agencyName, { font: "bold", size: 8.5, color: PAPER });
      const right = `Executive report · ${summary.period.label}`;
      p.drawTextAt(PAGE_W - p.marginX - p.widthOf(right, "regular", 8), 17, right, { size: 8, color: rgb("#c2c8d1") });
      p.cursor = 44;
    },
  });

  masthead(pdf, summary, opts);

  if (opts.note && opts.note.trim().length > 0) {
    pdf.ensureSpace(30);
    pdf.paragraph(opts.note.trim(), { font: "oblique", size: 9.5, color: SLATE, maxWidth: pdf.contentWidth - 40 });
    pdf.moveDown(4);
  }

  for (const section of EXECUTIVE_SECTIONS) {
    if (!chosen.has(section.id)) continue;
    switch (section.id) {
      case "kpis":
        renderKpis(pdf, summary);
        break;
      case "trend":
        renderTrend(pdf, summary);
        break;
      case "deadlines":
        renderDeadlines(pdf, summary);
        break;
      case "outcomes":
        renderOutcomes(pdf, summary);
        break;
      case "departments":
        renderDepartments(pdf, summary);
        break;
      case "impact":
        renderImpact(pdf, summary);
        break;
    }
  }

  closingNote(pdf);
  return pdf.finalize();
}

// --- building blocks --------------------------------------------------------

function masthead(pdf: StyledPdf, summary: ExecutiveSummary, opts: ExecutiveReportOptions): void {
  const BAND_H = 96;
  pdf.fillRect(0, 0, PAGE_W, BAND_H, INK);
  // Gold seam under the band — ornament, the same grammar as the app's civic hero.
  pdf.fillRect(0, BAND_H, PAGE_W, 2.5, GOLD);

  pdf.drawTextAt(pdf.marginX, 34, "PUBLIC RECORDS · EXECUTIVE REPORT", {
    size: 8,
    color: GOLD,
    charSpace: 1.1,
  });
  pdf.drawTextAt(pdf.marginX, 58, opts.agencyName, { font: "bold", size: 17, color: PAPER });
  pdf.drawTextAt(pdf.marginX, 78, summary.period.label, { size: 11, color: rgb("#c2c8d1") });

  const genLine = `Generated ${fmtDate(opts.generatedAt)}${opts.preparedBy ? ` · Prepared by ${opts.preparedBy}` : ""}`;
  pdf.drawTextAt(PAGE_W - pdf.marginX - pdf.widthOf(genLine, "regular", 8), 78, genLine, {
    size: 8,
    color: rgb("#c2c8d1"),
  });

  pdf.cursor = BAND_H + 18;

  // The honesty line the annual report carries — whether the deadline math
  // behind these numbers was ever legally reviewed.
  const review = opts.statuteReview
    ? `Statute configuration reviewed by counsel: ${opts.statuteReview.reviewedBy}, ${opts.statuteReview.reviewedOn}.`
    : "Statute configuration not yet reviewed by counsel.";
  pdf.textLine(review, { size: 8, color: MUTED });
  pdf.moveDown(6);
}

function sectionTitle(pdf: StyledPdf, label: string): void {
  pdf.ensureSpace(40);
  pdf.moveDown(10);
  // Gold tick before the title — the letterhead ornament .panel-title uses.
  pdf.fillRect(pdf.marginX, pdf.cursor + 1.5, 14, 3.5, GOLD);
  pdf.drawTextAt(pdf.marginX + 22, pdf.cursor + 8, label.toUpperCase(), {
    font: "bold",
    size: 9.5,
    color: INK,
    charSpace: 0.7,
  });
  pdf.moveDown(18);
}

function basisNote(pdf: StyledPdf, text: string): void {
  pdf.moveDown(2);
  pdf.paragraph(text, { font: "oblique", size: 7.2, color: MUTED, leading: 9.5 });
  pdf.moveDown(2);
}

interface Tile {
  value: string;
  label: string;
  delta?: string;
  deltaColor?: Rgb;
}

function tileRow(pdf: StyledPdf, tiles: Tile[]): void {
  const GAP = 10;
  const perRow = 3;
  const w = (pdf.contentWidth - GAP * (perRow - 1)) / perRow;
  const h = 56;
  for (let i = 0; i < tiles.length; i += perRow) {
    pdf.ensureSpace(h + GAP);
    const row = tiles.slice(i, i + perRow);
    row.forEach((tile, j) => {
      const x = pdf.marginX + j * (w + GAP);
      pdf.fillRect(x, pdf.cursor, w, h, PLATE);
      pdf.strokeRect(x, pdf.cursor, w, h, HAIRLINE, 0.7);
      // Gold base rule under the numeral — the .stat-num ornament.
      pdf.fillRect(x + 10, pdf.cursor + 27, 22, 1.6, GOLD);
      pdf.drawTextAt(x + 10, pdf.cursor + 23, tile.value, { font: "bold", size: 16, color: INK });
      pdf.drawTextAt(x + 10, pdf.cursor + 39, tile.label, { size: 7.3, color: SLATE });
      if (tile.delta) {
        pdf.drawTextAt(x + 10, pdf.cursor + 49, tile.delta, { size: 7.3, color: tile.deltaColor ?? MUTED });
      }
    });
    pdf.moveDown(h + GAP);
  }
}

/** "+3 vs prior period" deltas, with an honest em-dash when either side is unknowable. */
function delta(current: number | null, prior: number | null, unit = ""): string {
  if (current == null || prior == null) return `prior period: ${prior == null ? "—" : prior}`;
  const diff = current - prior;
  if (diff === 0) return "no change vs prior period";
  return `${diff > 0 ? "+" : ""}${diff}${unit ? ` ${unit}` : ""} vs prior period`;
}

function valence(current: number | null, prior: number | null, goodWhenUp: boolean): Rgb | undefined {
  if (current == null || prior == null || current === prior) return undefined;
  const up = current > prior;
  return up === goodWhenUp ? OK : DUE;
}

function barRow(
  pdf: StyledPdf,
  label: string,
  bars: Array<{ value: number; max: number; color: Rgb }>,
  valueText: string,
): void {
  const LABEL_W = 52;
  const VALUE_W = 96;
  const barX = pdf.marginX + LABEL_W;
  const barW = pdf.contentWidth - LABEL_W - VALUE_W;
  const barH = 5.5;
  const rowH = bars.length * (barH + 2) + 5;
  pdf.ensureSpace(rowH);
  pdf.drawTextAt(pdf.marginX, pdf.cursor + 8, label, { size: 7.5, color: MUTED });
  bars.forEach((bar, i) => {
    const y = pdf.cursor + 2 + i * (barH + 2);
    pdf.fillRect(barX, y, barW, barH, TRACK);
    const w = bar.max > 0 ? (bar.value / bar.max) * barW : 0;
    if (w > 0) pdf.fillRect(barX, y, Math.max(w, 1.5), barH, bar.color);
  });
  pdf.drawTextAt(PAGE_W - pdf.marginX - pdf.widthOf(valueText, "regular", 7.5), pdf.cursor + 8, valueText, {
    size: 7.5,
    color: SLATE,
  });
  pdf.moveDown(rowH);
}

function legend(pdf: StyledPdf, entries: Array<{ label: string; color: Rgb }>): void {
  pdf.ensureSpace(14);
  let x = pdf.marginX;
  for (const e of entries) {
    pdf.fillRect(x, pdf.cursor + 2, 6, 6, e.color);
    pdf.drawTextAt(x + 10, pdf.cursor + 8, e.label, { size: 7.5, color: MUTED });
    x += 10 + pdf.widthOf(e.label, "regular", 7.5) + 16;
  }
  pdf.moveDown(14);
}

function emptyLine(pdf: StyledPdf, text: string): void {
  pdf.paragraph(text, { size: 9, color: MUTED });
}

// --- sections ---------------------------------------------------------------

function renderKpis(pdf: StyledPdf, s: ExecutiveSummary): void {
  sectionTitle(pdf, "Headline numbers");
  const c = s.kpis.current;
  const p = s.kpis.prior;
  const fmtRate = (k: ExecutiveKpis) => (k.onTimeRate == null ? "—" : pct(k.onTimeRate));
  const ratePts =
    c.onTimeRate != null && p.onTimeRate != null
      ? Math.round((c.onTimeRate - p.onTimeRate) * 100)
      : null;
  tileRow(pdf, [
    { value: String(c.received), label: "Requests received", delta: delta(c.received, p.received) },
    { value: String(c.closed), label: "Requests closed", delta: delta(c.closed, p.closed) },
    {
      value: fmtRate(c),
      label: "On-time rate (closed this period)",
      delta:
        ratePts == null
          ? `prior period: ${fmtRate(p)}`
          : ratePts === 0
            ? "no change vs prior period"
            : `${ratePts > 0 ? "+" : ""}${ratePts} pts vs prior period`,
      deltaColor: valence(c.onTimeRate, p.onTimeRate, true),
    },
    {
      value: c.medianDaysToClose == null ? "—" : String(c.medianDaysToClose),
      label: "Median days to close",
      delta: delta(c.medianDaysToClose, p.medianDaysToClose, "days"),
      deltaColor: valence(c.medianDaysToClose, p.medianDaysToClose, false),
    },
    { value: String(c.backlogAtEnd), label: "Open at period end", delta: delta(c.backlogAtEnd, p.backlogAtEnd) },
    {
      value: String(c.overdueAtEnd),
      label: "Overdue at period end",
      delta: delta(c.overdueAtEnd, p.overdueAtEnd),
      deltaColor: valence(c.overdueAtEnd, p.overdueAtEnd, false),
    },
  ]);
  basisNote(pdf, s.kpis.basis);
}

function renderTrend(pdf: StyledPdf, s: ExecutiveSummary): void {
  sectionTitle(pdf, "Volume trend");
  const max = Math.max(...s.trend.buckets.map((b) => Math.max(b.received, b.closed)), 1);
  legend(pdf, [
    { label: "Received", color: SLATE },
    { label: "Closed", color: TEAL },
  ]);
  for (const b of s.trend.buckets) {
    barRow(
      pdf,
      b.label,
      [
        { value: b.received, max, color: SLATE },
        { value: b.closed, max, color: TEAL },
      ],
      `${b.received} in · ${b.closed} closed`,
    );
  }
  basisNote(pdf, s.trend.basis);
}

function renderDeadlines(pdf: StyledPdf, s: ExecutiveSummary): void {
  sectionTitle(pdf, "Deadline performance");
  const d = s.deadlines;
  const judged = d.closedOnTime + d.closedLate;
  if (judged === 0) {
    emptyLine(pdf, "No requests with a computed deadline were closed in this period.");
  } else {
    // One proportional band: on-time in green, late in red — the single
    // picture an oversight body actually reads.
    const barH = 14;
    pdf.ensureSpace(barH + 24);
    const w = pdf.contentWidth;
    const onW = (d.closedOnTime / judged) * w;
    pdf.fillRect(pdf.marginX, pdf.cursor, w, barH, TRACK);
    if (onW > 0) pdf.fillRect(pdf.marginX, pdf.cursor, onW, barH, OK);
    if (onW < w) pdf.fillRect(pdf.marginX + onW, pdf.cursor, w - onW, barH, OVERDUE);
    pdf.moveDown(barH + 6);
    pdf.textLine(
      `${d.closedOnTime} closed on time · ${d.closedLate} closed late (${pct(d.closedOnTime / judged)} on time)`,
      { size: 8.5, color: SLATE },
    );
  }
  pdf.moveDown(2);
  const median = d.medianDaysToClose == null ? "—" : `${d.medianDaysToClose} days`;
  const p90 = d.p90DaysToClose == null ? "—" : `${d.p90DaysToClose} days`;
  pdf.textLine(`Median time to close: ${median} · 90th percentile: ${p90}`, { size: 8.5, color: SLATE });
  pdf.textLine(
    `Statutory extensions taken this period: ${d.extensionsTaken}`,
    { size: 8.5, color: SLATE },
  );
  basisNote(pdf, d.basis);
}

function renderOutcomes(pdf: StyledPdf, s: ExecutiveSummary): void {
  sectionTitle(pdf, "Outcomes & exemptions");
  const o = s.outcomes;
  if (o.byStatus.length === 0 && o.referred === 0) {
    emptyLine(pdf, "No requests reached an outcome in this period.");
  } else {
    const max = Math.max(...o.byStatus.map((r) => r.count), 1);
    for (const row of o.byStatus) {
      barRow(pdf, STATUS_LABELS[row.status] ?? row.status, [{ value: row.count, max, color: SLATE }], String(row.count));
    }
    if (o.referred > 0) {
      pdf.textLine(`Referred to another agency this period: ${o.referred}`, { size: 8.5, color: SLATE });
    }
  }
  pdf.moveDown(4);
  if (o.exemptions.length === 0) {
    emptyLine(pdf, "No exemptions were cited on requests closed this period — every release went out unredacted and unwithheld.");
  } else {
    pdf.textLine("Exemptions cited:", { font: "bold", size: 8.5, color: INK });
    for (const e of o.exemptions) {
      pdf.textLine(`• ${e.label} — ${e.count} request${e.count === 1 ? "" : "s"}`, { size: 8.5, color: SLATE, x: pdf.marginX + 8 });
    }
  }
  basisNote(pdf, o.basis);
}

function renderDepartments(pdf: StyledPdf, s: ExecutiveSummary): void {
  sectionTitle(pdf, "Department activity");
  const rows = s.departments.rows;
  if (rows.length === 0) {
    emptyLine(pdf, "No tasks were dispatched to departments in this period.");
    basisNote(pdf, s.departments.basis);
    return;
  }
  const numW = 76;
  const nameW = pdf.contentWidth - numW * 3;
  const cols = ["Dispatched", "Done", "Outstanding"];
  pdf.ensureSpace(16);
  pdf.drawTextAt(pdf.marginX, pdf.cursor + 8, "DEPARTMENT", { size: 6.8, color: MUTED, charSpace: 0.5 });
  cols.forEach((c, i) => {
    const x = pdf.marginX + nameW + i * numW;
    pdf.drawTextAt(x + numW - pdf.widthOf(c.toUpperCase(), "regular", 6.8, 0.5), pdf.cursor + 8, c.toUpperCase(), {
      size: 6.8,
      color: MUTED,
      charSpace: 0.5,
    });
  });
  pdf.moveDown(12);
  pdf.line(pdf.marginX, pdf.cursor, PAGE_W - pdf.marginX, pdf.cursor, HAIRLINE, 0.7);
  pdf.moveDown(3);
  for (const row of rows) {
    pdf.ensureSpace(15);
    pdf.drawTextAt(pdf.marginX, pdf.cursor + 9, row.name, { size: 9, color: INK });
    [row.dispatched, row.done, row.outstanding].forEach((n, i) => {
      const x = pdf.marginX + nameW + i * numW;
      const text = String(n);
      pdf.drawTextAt(x + numW - pdf.widthOf(text, "regular", 9), pdf.cursor + 9, text, { size: 9, color: SLATE });
    });
    pdf.moveDown(13);
    pdf.line(pdf.marginX, pdf.cursor, PAGE_W - pdf.marginX, pdf.cursor, HAIRLINE, 0.4);
    pdf.moveDown(2);
  }
  basisNote(pdf, s.departments.basis);
}

function renderImpact(pdf: StyledPdf, s: ExecutiveSummary): void {
  sectionTitle(pdf, "Transparency impact");
  const i = s.impact;
  tileRow(pdf, [
    { value: String(i.deflections), label: "Requests deflected (answered by the archive)" },
    { value: String(i.hoursAvoided), label: "Estimated staff-hours avoided" },
    { value: String(i.archiveMisses), label: "Archive misses (unmet demand, not savings)" },
  ]);
  basisNote(pdf, i.basis);
}

function closingNote(pdf: StyledPdf): void {
  pdf.moveDown(8);
  pdf.paragraph(
    "Computed from the live request record. Every figure traces to the append-only request log; " +
      "per-request audit trails (the defensibility report) are available from each request's detail page, " +
      "and the annual compliance report carries the full-year statutory dataset.",
    { size: 7.2, color: MUTED, font: "oblique", leading: 9.5 },
  );
}
