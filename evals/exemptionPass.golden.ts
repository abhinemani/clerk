/**
 * Golden dataset for the exemption-pass evals (spec §13) — the highest-stakes
 * pipeline in the product, and the one that had no evals.
 *
 * Two kinds of label per document:
 *   - mustCatch: text a competent reviewer would ALWAYS redact. Missing one is
 *     the failure that ends careers and loses lawsuits, so recall is what this
 *     eval actually grades.
 *   - mustNotFlag: decoy text that looks sensitive but is plainly public (a
 *     city's own contract value, a public official acting officially, an
 *     address that is the subject of the request). Over-flagging isn't a
 *     catastrophe — it's one dismissal in the studio — so these are reported
 *     as precision, not a hard gate.
 *
 * All documents are synthetic. Any resemblance to a real person is accidental
 * and the values are deliberately invalid (555 numbers, 000-prefixed SSNs).
 */

export interface ExemptionGoldenCase {
  id: string;
  /** Human note on what this case is probing. */
  intent: string;
  lines: string[];
  /** The agency's configured exemption catalog for this case. */
  exemptions: string[];
  expect: {
    /** Substrings that MUST appear inside some flagged span. */
    mustCatch: string[];
    /** Substrings that should NOT be flagged (precision signal only). */
    mustNotFlag?: string[];
    /** True when the correct answer is "flag nothing". */
    expectNoFindings?: boolean;
  };
}

const CA_EXEMPTIONS = [
  "Personal privacy (Cal. Gov. Code § 7927.700)",
  "Law enforcement investigation (Cal. Gov. Code § 7923.600)",
  "Personnel records (Cal. Gov. Code § 7927.700)",
  "Medical information (Cal. Civ. Code § 56.10)",
  "Trade secret / proprietary (Cal. Gov. Code § 7927.705)",
  "Deliberative process (Cal. Gov. Code § 7927.500)",
];

export const EXEMPTION_GOLDEN: ExemptionGoldenCase[] = [
  {
    id: "incident-report-pii",
    intent: "Classic police incident report: witness PII must go, officer acting officially stays.",
    exemptions: CA_EXEMPTIONS,
    lines: [
      "RIVERTON POLICE DEPARTMENT — INCIDENT REPORT",
      "Case No: 2026-04182    Reporting Officer: Sgt. M. Alvarez (badge 2214)",
      "Location: 400 Main Street, Riverton",
      "",
      "Reporting party: Dana Whitfield",
      "Home address: 88 Larkspur Lane, Apt 4B",
      "Phone: (555) 013-8827",
      "Date of birth: 03/14/1979",
      "Driver license: D8834192",
      "",
      "Narrative: RP states an unknown subject damaged the vehicle overnight.",
      "Estimated damage $1,800. No injuries reported. Case referred to detectives.",
    ],
    expect: {
      mustCatch: [
        "Dana Whitfield",
        "88 Larkspur Lane",
        "(555) 013-8827",
        "03/14/1979",
        "D8834192",
      ],
      mustNotFlag: [
        "Sgt. M. Alvarez", // a named officer acting officially is disclosable in CA
        "400 Main Street", // the incident location is the subject of the request
        "$1,800",
      ],
    },
  },
  {
    id: "personnel-discipline",
    intent: "Personnel file: SSN and medical detail are hard exemptions; the discipline outcome is contested but the PII is not.",
    exemptions: CA_EXEMPTIONS,
    lines: [
      "CITY OF RIVERTON — PERSONNEL ACTION FORM",
      "Employee: Harold Nguyen    Title: Maintenance Worker II",
      "SSN: 000-45-6789",
      "Home phone: (555) 019-4402",
      "Personal email: harold.personal@example.com",
      "",
      "Medical accommodation: employee has a documented lumbar spine injury and is",
      "restricted from lifting more than 20 lbs per his physician's note dated 2026-02-11.",
      "",
      "Action: written reprimand for failure to complete the pre-shift vehicle check.",
      "Supervisor: D. Okafor, Public Works Superintendent",
    ],
    expect: {
      mustCatch: [
        "000-45-6789",
        "(555) 019-4402",
        "harold.personal@example.com",
        "lumbar spine injury",
      ],
      mustNotFlag: ["Maintenance Worker II", "D. Okafor"],
    },
  },
  {
    id: "vendor-contract-tradesecret",
    intent: "Contract: the price the public pays is public; the vendor's cost formula is a trade secret.",
    exemptions: CA_EXEMPTIONS,
    lines: [
      "AGREEMENT — BRIGHT PATH CONCRETE LLC (Contract C-2025-118)",
      "Total not-to-exceed amount: $184,000",
      "Term: July 1, 2025 through June 30, 2027",
      "",
      "Exhibit B — Confidential cost build-up (vendor proprietary):",
      "Vendor's internal batch-plant mix formula: 14.2% fly ash substitution with",
      "proprietary admixture ratio 3:1:0.4, yielding a per-yard cost basis of $61.40.",
      "",
      "Vendor contact: Danielle Okafor-Bright, (555) 019-8842",
      "Remit to account ending 4401, First Riverton Bank, EIN 98-7654321",
    ],
    expect: {
      mustCatch: [
        "fly ash substitution",
        "(555) 019-8842",
        "98-7654321",
      ],
      mustNotFlag: ["$184,000", "Bright Path Concrete LLC", "July 1, 2025"],
    },
  },
  {
    id: "active-investigation",
    intent: "Open investigation: informant identity and technique must go even though the case number is public.",
    exemptions: CA_EXEMPTIONS,
    lines: [
      "INVESTIGATIVE SUPPLEMENT — Case 2026-00931 (ACTIVE)",
      "Confidential informant: Marcus Webb, contacted via (555) 016-2093",
      "CI has provided reliable information in three prior cases.",
      "Surveillance: pole camera installed at the corner of 5th and Cedar on 2026-03-02.",
      "Status: active; no arrests to date.",
    ],
    expect: {
      mustCatch: ["Marcus Webb", "(555) 016-2093"],
      mustNotFlag: ["Case 2026-00931"],
    },
  },
  {
    id: "benign-minutes",
    intent: "Control case: fully public council minutes. The correct answer is to flag nothing.",
    exemptions: CA_EXEMPTIONS,
    lines: [
      "RIVERTON CITY COUNCIL — REGULAR MEETING MINUTES",
      "March 4, 2026, 7:00 PM, Council Chambers",
      "Present: Mayor L. Ortiz, Councilmembers Grant, Idris, Park, and Sultana.",
      "",
      "Item 3: Award of the Maple Avenue sidewalk contract to Bright Path Concrete",
      "in the amount of $184,000. Motion by Grant, seconded by Park. Passed 5-0.",
      "Item 4: Public comment. Two residents spoke regarding street lighting.",
    ],
    expect: {
      mustCatch: [],
      mustNotFlag: ["Mayor L. Ortiz", "$184,000", "Bright Path Concrete", "Grant"],
      expectNoFindings: true,
    },
  },
];
