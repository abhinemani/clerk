/**
 * Pre-release "missed PII" safety net (spec §6.5): "before release, a pass over
 * the final artifact flags 'possible missed PII' as a last-line safety net."
 *
 * Runs the deterministic PII scan over the ALREADY-REDACTED release text. After
 * a true-redaction burn, redacted values are gone, so anything this finds is PII
 * a redaction missed — surfaced to the reviewer before the document goes out.
 */
import { scanPii, summarizePii, type PiiFinding } from "./piiScan";

export interface ResidualCheck {
  clean: boolean;
  findings: PiiFinding[];
  summary: Record<string, number>;
}

export function checkResidualPii(releasedLines: string[]): ResidualCheck {
  const findings = releasedLines.flatMap((line, i) =>
    scanPii(line).map((f) => ({ ...f, line: i } as PiiFinding & { line: number })),
  );
  return { clean: findings.length === 0, findings, summary: summarizePii(findings) };
}
