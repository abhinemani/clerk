/**
 * Redaction profiles (spec §6.5) — "agencies redact the same record types the
 * same way, forever." Per-record-type profiles seed the suggestion pass so
 * routine documents arrive ~90% pre-marked. Deterministic (regex + the PII pass),
 * so the studio opens with suggestions before any model call.
 */
import { suggestRedactionsFromPii, type RedactionSpan } from "@/domain/redaction";

export interface Suggestion extends RedactionSpan {
  reason: string;
  source: "pii" | "profile";
}

interface ProfileRule {
  exemption: string;
  pattern: RegExp; // global; matched per line
}

export interface RedactionProfile {
  recordType: string;
  label: string;
  rules: ProfileRule[];
}

const ADDRESS =
  /\b\d{1,5}\s+[A-Z][a-z]+(?:\s[A-Z][a-z]+)*\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Lane|Ln|Dr|Drive|Ct|Court)\b/g;

/** Starter profiles for common municipal record types. */
export const REDACTION_PROFILES: RedactionProfile[] = [
  {
    recordType: "police_incident",
    label: "Police incident report",
    rules: [
      { exemption: "Personal privacy — date of birth", pattern: /\b(?:0?[1-9]|1[0-2])[/-](?:0?[1-9]|[12]\d|3[01])[/-]\d{4}\b/g },
      { exemption: "Personal privacy — home address", pattern: ADDRESS },
      { exemption: "Personal privacy — officer identifier", pattern: /\bbadge\s*#?\s*\d+/gi },
      { exemption: "Juvenile identifier", pattern: /\b(?:juvenile|minor)\b/gi },
      { exemption: "Personal privacy — ID number", pattern: /\bDL\s+[A-Z0-9]{5,}\b/g },
    ],
  },
  {
    recordType: "personnel",
    label: "Personnel record",
    rules: [
      { exemption: "Personnel privacy", pattern: /\b(?:disciplinary|evaluation|complaint|reprimand|suspension)\b/gi },
      { exemption: "Personal privacy — date of birth", pattern: /\b(?:0?[1-9]|1[0-2])[/-](?:0?[1-9]|[12]\d|3[01])[/-]\d{4}\b/g },
    ],
  },
  {
    recordType: "contract",
    label: "Contract / procurement",
    rules: [{ exemption: "Trade secret / proprietary", pattern: /\b(?:proprietary|confidential|trade secret)\b/gi }],
  },
];

export function getRedactionProfile(recordType: string): RedactionProfile | undefined {
  return REDACTION_PROFILES.find((p) => p.recordType === recordType);
}

function profileRuleSuggestions(profile: RedactionProfile, lines: string[]): Suggestion[] {
  const out: Suggestion[] = [];
  lines.forEach((text, line) => {
    for (const rule of profile.rules) {
      rule.pattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = rule.pattern.exec(text)) !== null) {
        out.push({ line, startCol: m.index, endCol: m.index + m[0].length, reason: rule.exemption, source: "profile" });
        if (m[0].length === 0) rule.pattern.lastIndex++;
      }
    }
  });
  return out;
}

function dedupe(suggestions: Suggestion[]): Suggestion[] {
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const s of suggestions.sort((a, b) => a.line - b.line || a.startCol - b.startCol)) {
    const key = `${s.line}:${s.startCol}:${s.endCol}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/**
 * Seed the studio: profile rules for the record type PLUS the deterministic PII
 * pass, deduped. This is what makes routine documents arrive mostly pre-marked.
 */
export function seededSuggestions(recordType: string | undefined, lines: string[]): Suggestion[] {
  const pii: Suggestion[] = suggestRedactionsFromPii(lines).map((s) => ({
    line: s.line,
    startCol: s.startCol,
    endCol: s.endCol,
    reason: s.reason ?? "Personal privacy",
    source: "pii",
  }));
  const profile = recordType ? getRedactionProfile(recordType) : undefined;
  const fromProfile = profile ? profileRuleSuggestions(profile, lines) : [];
  return dedupe([...pii, ...fromProfile]);
}
