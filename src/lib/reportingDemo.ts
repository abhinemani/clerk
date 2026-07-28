/**
 * Deterministic synthetic history for the reporting demo (§11). Real numbers
 * come from the repository once persistence lands; this makes the report page
 * show a realistic year without a database.
 */
import type { RequestForMetrics } from "@/reporting/metrics";

const MS_DAY = 86_400_000;
const TYPES = ["individual", "media", "legal", "commercial", "government"];
const EXEMPTIONS = ["Personal privacy", "Law enforcement", "Deliberative process", "Attorney-client"];

export function reportingDataset(): RequestForMetrics[] {
  const out: RequestForMetrics[] = [];
  for (let i = 0; i < 48; i++) {
    const month = i % 6; // Jan–Jun 2026
    const received = new Date(Date.UTC(2026, month, 3 + (i % 20)));
    const span = 4 + (i % 12); // 4..15 days
    const closedAt = i % 9 === 0 ? null : new Date(received.getTime() + span * MS_DAY);
    out.push({
      receivedAt: received,
      closedAt,
      statutoryDueAt: new Date(received.getTime() + 10 * MS_DAY), // CA 10 calendar days
      status: closedAt ? "fulfilled" : "in_progress",
      requesterType: TYPES[i % TYPES.length]!,
      extended: i % 5 === 0,
      exemptionsCited: i % 3 === 0 ? [EXEMPTIONS[i % EXEMPTIONS.length]!] : [],
    });
  }
  return out;
}

export const DEFLECTIONS_YTD = 214;
