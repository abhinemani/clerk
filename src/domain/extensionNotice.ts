/**
 * Extension notice composition (spec §6.6 "extension", §7).
 *
 * Statutes that permit an extension almost always require notice to the
 * requester citing the permitted reason and the new date. Deterministic like
 * the denial letter: the statutory facts arrive as data and ship verbatim —
 * the reason must be one the statute permits (validated upstream in
 * computeDueDate), and the new date is the computed one, never prose.
 */
export interface ExtensionNoticeInput {
  publicId: string;
  agencyName: string;
  requesterName?: string | null;
  /** The request in the office's words (interpreted scope or raw text). */
  requestSummary: string;
  days: number;
  dayType: "calendar" | "business";
  /** The statute's permitted reason, exactly as configured (§7). */
  reason: string;
  priorDueDate: string; // ISO date "YYYY-MM-DD"
  newDueDate: string; // ISO date
  /** Optional staff note giving specifics (which facility, which agency…). */
  note?: string;
}

export function composeExtensionNotice(input: ExtensionNoticeInput): string {
  const lines: string[] = [
    `Re: Public records request ${input.publicId}`,
    ``,
    `Dear ${input.requesterName?.trim() || "Requester"},`,
    ``,
    `This is a notice regarding your public records request: "${input.requestSummary}".`,
    ``,
    `${input.agencyName} is extending the response deadline by ${input.days} ${input.dayType} day(s), as permitted by statute, for the following reason:`,
    `  • ${input.reason}`,
  ];
  if (input.note?.trim()) {
    lines.push(``, input.note.trim());
  }
  lines.push(
    ``,
    `The prior response date was ${input.priorDueDate}. The new response date is ${input.newDueDate}.`,
    ``,
    `No action is needed from you. Work on your request continues, and you will hear from us on or before the new date.`,
    ``,
    `Sincerely,`,
    `${input.agencyName} — Public Records Office`,
  );
  return lines.join("\n");
}
