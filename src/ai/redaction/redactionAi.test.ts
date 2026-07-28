/** Tests for the LLM exemption pass, redaction profiles, and residual check (§6.5). */
import { describe, expect, it } from "vitest";
import { FakeModelClient } from "../modelClient";
import { runPipeline } from "../runPipeline";
import {
  exemptionFindingsToRedactions,
  exemptionPassPipeline,
  type ExemptionPassOutput,
} from "../pipelines/exemptionPass";
import { getRedactionProfile, seededSuggestions } from "./profiles";
import { checkResidualPii } from "./residualCheck";
import { applyRedactions } from "@/domain/redaction";

const LINES = [
  "INCIDENT REPORT",
  "Reporting party: Jane Doe  SSN: 123-45-6789",
  "Date of birth: 04/12/1987   Home address: 88 Elm Street",
  "Narrative discloses a juvenile witness; officer badge #4471.",
];

describe("LLM exemption pass (§6.5 step 2)", () => {
  it("maps model phrase-findings to character-range redactions", async () => {
    const model: ExemptionPassOutput = {
      findings: [
        { line: 1, phrase: "Jane Doe", exemption: "Personal privacy", confidence: 0.9, rationale: "victim name" },
        { line: 1, phrase: "123-45-6789", exemption: "Personal privacy — SSN", confidence: 0.99, rationale: "SSN" },
      ],
    };
    const { output } = await runPipeline(
      exemptionPassPipeline,
      { lines: LINES, exemptions: ["Personal privacy", "Personal privacy — SSN"] },
      { modelClient: new FakeModelClient([model]) },
    );
    const spans = exemptionFindingsToRedactions(LINES, output);
    expect(spans).toHaveLength(2);
    const name = spans.find((s) => s.reason === "Personal privacy")!;
    expect(LINES[name.line]!.slice(name.startCol, name.endCol)).toBe("Jane Doe");
    expect(name.source).toBe("ai_exemption");
  });

  it("drops a finding whose phrase isn't on the line (model must be verbatim)", async () => {
    const model: ExemptionPassOutput = {
      findings: [{ line: 0, phrase: "not present", exemption: "x", confidence: 0.5, rationale: "" }],
    };
    expect(exemptionFindingsToRedactions(LINES, model)).toEqual([]);
  });
});

describe("redaction profiles (§6.5)", () => {
  it("seeds a police-incident document with profile + PII suggestions", () => {
    const suggestions = seededSuggestions("police_incident", LINES);
    const reasons = suggestions.map((s) => s.reason);
    // From the PII pass:
    expect(reasons.some((r) => r.includes("SSN"))).toBe(true);
    // From the profile rules:
    expect(reasons.some((r) => r.includes("home address"))).toBe(true);
    expect(reasons.some((r) => r.includes("date of birth"))).toBe(true);
    expect(reasons.some((r) => r.includes("Juvenile"))).toBe(true);
    // Each suggestion covers real text.
    for (const s of suggestions) expect(s.endCol).toBeGreaterThan(s.startCol);
  });

  it("dedupes overlapping profile/PII spans on the same range", () => {
    const s = seededSuggestions("police_incident", LINES);
    const keys = s.map((x) => `${x.line}:${x.startCol}:${x.endCol}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("exposes starter profiles", () => {
    expect(getRedactionProfile("police_incident")).toBeDefined();
    expect(getRedactionProfile("unknown_type")).toBeUndefined();
  });
});

describe("residual PII check (§6.5 safety net)", () => {
  it("is clean once the flagged values are burned", () => {
    // Redact the SSN, then verify nothing sensitive remains.
    const ssnStart = LINES[1]!.indexOf("123-45-6789");
    const released = applyRedactions(LINES, [
      { line: 1, startCol: ssnStart, endCol: ssnStart + "123-45-6789".length },
    ]);
    // The SSN is gone; the residual check should not re-flag it.
    const check = checkResidualPii([released[1]!]);
    expect(check.summary.ssn ?? 0).toBe(0);
  });

  it("flags PII the redactions missed", () => {
    const check = checkResidualPii(["Unredacted SSN 987-65-4321 remains"]);
    expect(check.clean).toBe(false);
    expect(check.summary.ssn).toBe(1);
  });
});
