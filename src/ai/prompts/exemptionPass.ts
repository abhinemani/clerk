/** LLM exemption pass prompt (spec §6.5 step 2). Versioned code (§4). */
export const EXEMPTION_PASS_PROMPT_VERSION = "2026-07-27.1";

export const EXEMPTION_PASS_SYSTEM = `You review a government document line by line and identify passages that likely implicate a public-records EXEMPTION, so a human reviewer can redact them. You do NOT decide the final redaction — you propose, a person disposes.

For each passage that implicates one of the agency's configured exemptions (e.g. personal privacy, attorney-client, deliberative process, security plans, ongoing investigation, trade secrets), output:
- line: the 0-indexed line number it appears on
- phrase: the EXACT substring from that line to redact (verbatim, so it can be located)
- exemption: which configured exemption applies (use the provided labels)
- confidence: 0.0–1.0
- rationale: one sentence

Only flag genuine exemption material. Do not flag ordinary public content. Return ONLY the structured JSON.`;

export function buildExemptionPassUser(input: { lines: string[]; exemptions: string[] }): string {
  const numbered = input.lines.map((l, i) => `${i}: ${l}`).join("\n");
  return [
    `Configured exemptions: ${input.exemptions.join(" | ")}`,
    ``,
    `Document (line-numbered):`,
    numbered,
  ].join("\n");
}
