/**
 * Proactive-publication recommendations (spec §6.7): "Monthly, generate a
 * staff-facing report: 'Your top repeatedly-requested record types — consider
 * publishing (or connecting) these proactively.'" Closes the loop between
 * request patterns and the data plane. Pure aggregation.
 */
export interface RequestRecordTypes {
  recordTypes: string[];
}

export interface PublicationRecommendation {
  recordType: string;
  requestCount: number;
  recommendation: string;
}

/**
 * Rank record types by how often they're requested; recommend proactively
 * publishing/connecting the ones requested at least `minCount` times.
 */
export function proactivePublicationReport(
  requests: RequestRecordTypes[],
  opts: { minCount?: number; limit?: number } = {},
): PublicationRecommendation[] {
  const minCount = opts.minCount ?? 3;
  const limit = opts.limit ?? 5;

  const counts: Record<string, number> = {};
  for (const r of requests) for (const rt of r.recordTypes) counts[rt] = (counts[rt] ?? 0) + 1;

  return Object.entries(counts)
    .filter(([, c]) => c >= minCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([recordType, requestCount]) => ({
      recordType,
      requestCount,
      recommendation: `Requested ${requestCount}× — consider publishing "${recordType}" to the public archive or connecting the source system so it deflects future requests.`,
    }));
}
