/**
 * Denial letter composition (spec §6.6 "denial", §7 appeal language).
 *
 * A denial is the most litigated letter a records office sends, so the
 * composition is deterministic and testable: statute citations come from the
 * agency's configured exemption catalog, and the appeal-rights paragraph is
 * included exactly as the statute profile provides it (invariant: appeal
 * language ships verbatim, never paraphrased by AI or staff shortcuts).
 */
export interface DenialExemption {
  /** Statute citation, e.g. "Cal. Gov. Code § 7923.600". */
  citation: string;
  /** Plain-language label, e.g. "Law enforcement investigation". */
  label?: string;
}

export interface DenialLetterInput {
  publicId: string;
  agencyName: string;
  requesterName?: string | null;
  /** The request in the office's words (interpreted scope or raw text). */
  requestSummary: string;
  exemptions: DenialExemption[];
  /**
   * "No responsive records" determination: a reasonable search located
   * nothing. No exemptions are cited — there is nothing to exempt.
   */
  noRecords?: boolean;
  /** Appeal process language from the statute profile — included verbatim. */
  appealProcess?: string | null;
  appealDeadlineDays?: number | null;
  /** Optional staff-written explanation inserted before the citations. */
  explanation?: string;
}

export function composeDenialLetter(input: DenialLetterInput): string {
  const lines: string[] = [
    `Re: Public records request ${input.publicId}`,
    ``,
    `Dear ${input.requesterName?.trim() || "Requester"},`,
    ``,
    `This letter responds to your public records request: "${input.requestSummary}".`,
    ``,
    input.noRecords
      ? `${input.agencyName} conducted a reasonable search and located no records responsive to your request. This letter closes your request on that basis.`
      : `After review, ${input.agencyName} has determined that the responsive records are exempt from disclosure and your request is denied.`,
  ];

  if (input.explanation?.trim()) {
    lines.push(``, input.explanation.trim());
  }

  if (!input.noRecords) {
    lines.push(``, `This determination rests on the following exemption${input.exemptions.length === 1 ? "" : "s"}:`);
    for (const e of input.exemptions) {
      lines.push(`  • ${e.citation}${e.label ? ` — ${e.label}` : ""}`);
    }
  }

  lines.push(``, `Your appeal rights:`);
  if (input.appealProcess?.trim()) {
    lines.push(
      input.appealProcess.trim() +
        (input.appealDeadlineDays ? ` Appeals must be filed within ${input.appealDeadlineDays} days.` : ""),
    );
  } else {
    lines.push(
      `You may seek review of this determination as provided by your state's public records law. [Appeal language not configured for this agency — confirm with counsel before sending.]`,
    );
  }

  lines.push(``, `Sincerely,`, `${input.agencyName} — Public Records Office`);
  return lines.join("\n");
}
