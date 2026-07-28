/**
 * A small mixed-classification corpus for search + answer-engine tests/demo.
 * Includes INTERNAL documents on purpose, so the public-only scoping (§6.7,
 * §16.3) and the §13 hard-fail eval have something to (correctly) exclude.
 */
export interface CorpusDoc {
  id: string;
  title: string;
  text: string;
  classification: "public" | "internal";
  recordType?: string;
  externalDeepLink?: string;
}

export const DEMO_CORPUS: CorpusDoc[] = [
  {
    id: "d-paving",
    title: "Riverton–Acme Paving Contract (2025)",
    text: "Executed street resurfacing contract with Acme Paving awarded March 2025, value $1.2M, covering Main Street and downtown corridors.",
    classification: "public",
    recordType: "contract",
    externalDeepLink: "https://erp.riverton.gov/contracts/2025-acme",
  },
  {
    id: "d-minutes",
    title: "City Council Minutes — 2024",
    text: "Adopted City Council meeting minutes for 2024, including votes on zoning, the paving program, and the annual budget.",
    classification: "public",
    recordType: "minutes",
  },
  {
    id: "d-budget",
    title: "Adopted FY2025 City Budget",
    text: "The adopted fiscal year 2025 budget with department allocations, capital projects, and public works spending.",
    classification: "public",
    recordType: "budget",
  },
  // --- internal: must never surface to requesters ---
  {
    id: "d-personnel",
    title: "Personnel file — Officer J. Smith",
    text: "Internal affairs and disciplinary history for Officer Smith, including complaint records and evaluations.",
    classification: "internal",
    recordType: "personnel",
  },
  {
    id: "d-legal-memo",
    title: "Legal memo — pending litigation, 400 Main St",
    text: "Attorney work product analyzing exposure in the pending 400 Main St matter. Deliberative; do not release.",
    classification: "internal",
    recordType: "legal",
  },
];
