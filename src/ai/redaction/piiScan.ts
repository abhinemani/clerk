/**
 * Deterministic PII / pattern pass — step 1 of the redaction pipeline (spec §6.5).
 *
 * "regex + NER for SSNs, DOBs, driver's licenses, financial accounts, phone
 *  numbers, home addresses, minors' names, medical terms. Cheap, recall-oriented."
 *
 * This is the cheap, recall-first pass; the LLM exemption pass (§6.5 step 2) and
 * human review provide precision. Name/minor detection needs the LLM pass —
 * regex handles the structured identifiers here, plus a medical-term keyword
 * scan. Pure and heavily testable; it anchors the §13 PII-recall eval target.
 */
export type PiiType =
  | "ssn"
  | "ein"
  | "email"
  | "phone"
  | "credit_card"
  | "bank_account"
  | "drivers_license"
  | "ip_address"
  | "date" // DOB candidate — dates are common, flagged low-confidence
  | "medical_term";

export type Confidence = "low" | "medium" | "high";

export interface PiiFinding {
  type: PiiType;
  value: string;
  start: number;
  end: number;
  confidence: Confidence;
}

interface Matcher {
  type: PiiType;
  re: RegExp;
  confidence: Confidence;
  /** Optional refinement: return null to reject, or override type/confidence. */
  refine?: (raw: string) => { type?: PiiType; confidence?: Confidence } | null;
}

// Medical-term keyword list (recall-oriented; a real deployment extends this).
const MEDICAL_TERMS = [
  "diagnosis",
  "prescription",
  "prognosis",
  "hiv",
  "aids",
  "cancer",
  "psychiatric",
  "mental health",
  "substance abuse",
  "disability",
  "pregnan", // pregnant / pregnancy
  "medication",
  "hospitaliz", // hospitalized / hospitalization
];

const MEDICAL_RE = new RegExp(`\\b(${MEDICAL_TERMS.join("|")})\\w*`, "gi");

function luhnValid(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

const MATCHERS: Matcher[] = [
  { type: "ssn", re: /\b\d{3}[-\s]\d{2}[-\s]\d{4}\b/g, confidence: "high" },
  { type: "ein", re: /\b\d{2}-\d{7}\b/g, confidence: "medium" },
  {
    type: "email",
    re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    confidence: "high",
  },
  {
    type: "phone",
    re: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g,
    confidence: "medium",
  },
  {
    type: "ip_address",
    re: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g,
    confidence: "high",
  },
  {
    // Long digit runs (with optional space/dash grouping): card if Luhn-valid,
    // otherwise a probable account number (low confidence, recall-first).
    type: "credit_card",
    re: /\b\d(?:[ -]?\d){11,18}\b/g,
    confidence: "high",
    refine: (raw) => {
      const digits = raw.replace(/[ -]/g, "");
      if (digits.length >= 13 && digits.length <= 19 && luhnValid(digits)) {
        return { type: "credit_card", confidence: "high" };
      }
      if (digits.length >= 8) return { type: "bank_account", confidence: "low" };
      return null;
    },
  },
  {
    type: "drivers_license",
    re: /\b(?:DL|driver'?s?\s+licen[sc]e)\s*[#:]?\s*([A-Z0-9]{5,})/gi,
    confidence: "medium",
  },
  {
    type: "date",
    re: /\b(?:0?[1-9]|1[0-2])[/-](?:0?[1-9]|[12]\d|3[01])[/-](?:\d{4}|\d{2})\b/g,
    confidence: "low",
  },
  { type: "medical_term", re: MEDICAL_RE, confidence: "low" },
];

const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

/**
 * Scan text for PII patterns. Returns findings sorted by position, with
 * fully-contained overlaps removed (the enclosing / higher-confidence finding
 * wins) so a single value isn't double-counted across matchers.
 */
export function scanPii(text: string): PiiFinding[] {
  const found: PiiFinding[] = [];

  for (const m of MATCHERS) {
    // Reset lastIndex — module-level regexes are reused across calls.
    m.re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = m.re.exec(text)) !== null) {
      const raw = match[0];
      let type = m.type;
      let confidence = m.confidence;
      if (m.refine) {
        const r = m.refine(raw);
        if (r === null) continue;
        if (r.type) type = r.type;
        if (r.confidence) confidence = r.confidence;
      }
      found.push({ type, value: raw, start: match.index, end: match.index + raw.length, confidence });
      if (raw.length === 0) m.re.lastIndex++; // guard against zero-width loops
    }
  }

  return resolveOverlaps(found);
}

/** Drop findings fully contained in another; break ties by confidence, then length. */
export function resolveOverlaps(findings: PiiFinding[]): PiiFinding[] {
  const sorted = [...findings].sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: PiiFinding[] = [];
  for (const f of sorted) {
    const container = kept.find((k) => k.start <= f.start && k.end >= f.end);
    if (container) {
      // Replace the container only if this finding is strictly stronger and equal span.
      if (
        container.start === f.start &&
        container.end === f.end &&
        CONFIDENCE_RANK[f.confidence] > CONFIDENCE_RANK[container.confidence]
      ) {
        kept[kept.indexOf(container)] = f;
      }
      continue;
    }
    kept.push(f);
  }
  return kept.sort((a, b) => a.start - b.start);
}

/** Counts by type — handy for the sensitivity pre-scan banner (§6.5). */
export function summarizePii(findings: PiiFinding[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const f of findings) counts[f.type] = (counts[f.type] ?? 0) + 1;
  return counts;
}
