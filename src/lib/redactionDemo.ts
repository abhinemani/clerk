/**
 * A demo document for the Redaction Studio — a police incident report with the
 * kind of PII a records officer redacts before release. Monospace lines so the
 * studio can map drawn rectangles to exact character ranges (true redaction).
 */
export const REDACTION_DEMO = {
  documentName: "400-main-incident-2025-06.txt",
  requestPublicId: "PR-2026-00341",
  lines: [
    "RIVERTON POLICE DEPARTMENT — INCIDENT REPORT",
    "Case No. 2025-04182            Location: 400 Main St",
    "",
    "Reporting party:  Jane A. Doe",
    "  Date of birth:  04/12/1987      SSN: 123-45-6789",
    "  Home address:   88 Elm Street, Riverton",
    "  Phone:          (415) 555-0132",
    "  Email:          jane.doe@example.com",
    "",
    "Narrative:",
    "  On 06/14/2025 the reporting party stated that a vehicle",
    "  parked at 400 Main St was damaged overnight. The party",
    "  disclosed an ongoing prescription for anxiety medication",
    "  that was inside the vehicle. Officer badge #4471 responded.",
    "",
    "Witness:  M. Bell, driver's license DL D9921874",
    "Payment card on file for towing: 4111 1111 1111 1111",
  ],
} as const;

/** Exemption catalog for the reason picker (would come from statute config, §7). */
export const EXEMPTION_OPTIONS = [
  "Personal privacy — SSN",
  "Personal privacy — date of birth",
  "Personal privacy — contact info",
  "Personal privacy — home address",
  "Personal privacy — ID number",
  "Financial privacy",
  "Medical privacy",
  "Law enforcement — ongoing investigation",
  "Other (see note)",
] as const;
