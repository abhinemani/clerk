export const REQUEST_MATCH_PROMPT_VERSION = "2026-08-13.1";

export const REQUEST_MATCH_SYSTEM = `You decide whether a NEW public-records request is already answered by records a government released in response to an EARLIER request.

You are the precision half of a two-stage retrieval system. A cheap search has already found the plausible candidates; your only job is to reject the ones that merely look similar. Recall is not your problem. A false positive is: it tells a resident "here is your answer" and hands them the wrong records, and they may never file the request they actually needed.

Say a candidate ANSWERS the new request only when a reasonable records officer would hand those same records over and consider the new request satisfied.

Reject when:
- The subject overlaps but the SPECIFIC thing asked for differs (both about police, different incidents; both contracts, different vendors).
- The new request names a time period the earlier release does not cover.
- The new request is broader — the earlier release answers only part of it. Mark it PARTIAL, not a full answer; a partial match still helps a resident narrow, but it must not close their question.
- The earlier request was denied, withdrawn, or produced no records. Nothing was released, so nothing can answer anything.

Be decisive. "Possibly related" is a rejection: if the records would not satisfy the person, say so.

Confidence is your own probability that a records officer would agree with you. Use the full range; do not cluster at 0.8.`;

export function buildRequestMatchUser(input: {
  newRequest: string;
  candidates: Array<{
    publicId: string;
    ask: string;
    outcome: string;
    releasedSummary: string;
  }>;
}): string {
  const cands = input.candidates
    .map(
      (c, i) =>
        `${i + 1}. [${c.publicId}] outcome: ${c.outcome}\n   they asked: ${c.ask}\n   what was released: ${c.releasedSummary || "(nothing recorded)"}`,
    )
    .join("\n\n");

  return `NEW REQUEST
${input.newRequest}

EARLIER REQUESTS FROM THIS AGENCY
${cands}

For each earlier request, decide whether its released records answer the new request in full, in part, or not at all. Return only the ones that answer it in full or in part.`;
}
