/**
 * Drafted-correspondence prompt (spec §6.6). Versioned code (§4).
 *
 * One pipeline drafts every outbound touchpoint; the letter KIND plus a context
 * bag select the content. Tone defaults to plain-language (§6.6: "it reduces
 * appeals"). The draft opens in an editor; staff edit and send (§10 — no
 * outbound reaches a requester without a named human).
 */
export type CorrespondenceKind =
  | "acknowledgment"
  | "clarification"
  | "extension"
  | "fee_estimate"
  | "partial_release"
  | "denial"
  | "closure";

export const CORRESPONDENCE_PROMPT_VERSION = "2026-07-27.1";

const KIND_GUIDANCE: Record<CorrespondenceKind, string> = {
  acknowledgment:
    "Acknowledge receipt, restate the request in plain language, and state the statutory due date exactly as provided.",
  clarification:
    "Politely ask the clarifying questions provided so the request can be narrowed. Explain that answering speeds fulfillment.",
  extension:
    "Notify the requester of an extension, citing the statutory basis provided and the new due date. Keep it factual.",
  fee_estimate:
    "Present the itemized fee estimate provided, the total, and how to proceed with payment or request a waiver.",
  partial_release:
    "Transmit the released records, enumerate what is included, and list each withholding/redaction with its exemption citation.",
  denial:
    "State the denial and its basis using the exemption citations provided, then include the appeal-rights language provided verbatim.",
  closure: "Confirm the request is closed and summarize what was provided.",
};

export const CORRESPONDENCE_SYSTEM = `You draft correspondence from a government records office to a public-records requester. A named staff member reviews and sends every letter — you produce a draft, never a final send.

Rules:
- Use only the facts in the provided context. Do not invent dates, citations, fees, or record contents.
- Default to a clear, plain-language tone unless told otherwise; plain language reduces appeals.
- Include the statutory citations, deadlines, and appeal language exactly as provided in the context.
- If the context is missing something you need (e.g. a due date for an acknowledgment, appeal language for a denial), still draft the letter but add a warning naming what is missing so staff can fill it in.

Return ONLY the structured JSON with subject, body, and any warnings.`;

export function buildCorrespondenceUser(input: {
  kind: CorrespondenceKind;
  tone?: "plain" | "formal";
  context: Record<string, unknown>;
}): string {
  return [
    `Letter type: ${input.kind}`,
    `Guidance: ${KIND_GUIDANCE[input.kind]}`,
    `Tone: ${input.tone ?? "plain"}`,
    `Context (JSON):\n${JSON.stringify(input.context, null, 2)}`,
  ].join("\n\n");
}
