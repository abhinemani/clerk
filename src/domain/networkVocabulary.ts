/**
 * Controlled vocabularies for network plays (docs/network-plays.md,
 * invariant 11).
 *
 * THE WHOLE POINT: nothing tenant-authored may cross a tenant boundary, so a
 * contribution is assembled only from symbols defined HERE. Scrubbing tenant
 * strings would be a denylist, and denylists fail open on the one term nobody
 * thought of; an allowlist of platform-defined codes fails CLOSED — an input
 * that doesn't map produces nothing at all.
 *
 * Consequence to expect and not "fix": early on, most plays will not map, and
 * the network will stay quiet. That is the design working. Widening a
 * vocabulary later is additive and safe; letting free text through once is
 * not reversible.
 *
 * Everything here is pure and data-driven — add a topic by adding an entry,
 * no code change (the §7 statute-profile pattern).
 */

/** Platform-defined subject codes. Carries no requester wording by construction. */
export type TopicCode =
  | "police_incident_reports"
  | "police_bodycam"
  | "police_use_of_force"
  | "emergency_911"
  | "personnel_records"
  | "payroll_salary"
  | "contracts_procurement"
  | "budget_financial"
  | "building_permits"
  | "code_enforcement"
  | "inspections"
  | "zoning_planning"
  | "property_records"
  | "business_licenses"
  | "meeting_minutes"
  | "ordinances_resolutions"
  | "email_correspondence"
  | "litigation_claims"
  | "public_works_infrastructure"
  | "utilities"
  | "transit"
  | "parks_recreation"
  | "animal_control"
  | "health_safety"
  | "elections"
  | "education_student";

/**
 * Trigger terms per topic, WEIGHTED by how much the term defines the topic:
 *   3 = defining ("bodycam" means bodycam and nothing else)
 *   2 = strong
 *   1 = supporting — corroborates, but must never carry a match alone
 *
 * Weights exist because raw term counting mis-files on generic words: a play
 * about an annual budget report would match the bare term "report" under
 * police_incident_reports and, being the only match, WIN. Requiring
 * MIN_TOPIC_SCORE means supporting terms can only tip a decision that
 * defining terms already support.
 *
 * Matched against a play's keywords; never stored, never shipped.
 */
const TOPIC_TERMS: Record<TopicCode, [string, number][]> = {
  police_incident_reports: [["police", 3], ["incident", 3], ["arrest", 3], ["crime", 2], ["officer", 2], ["citation", 1], ["report", 1]],
  police_bodycam: [["bodycam", 3], ["dashcam", 3], ["footage", 2], ["camera", 2], ["body", 1], ["video", 1]],
  police_use_of_force: [["force", 3], ["shooting", 3], ["taser", 3], ["misconduct", 3], ["affairs", 2], ["complaint", 1], ["internal", 1]],
  emergency_911: [["911", 3], ["dispatch", 3], ["cad", 2], ["emergency", 2], ["audio", 1], ["call", 1]],
  personnel_records: [["personnel", 3], ["disciplinary", 3], ["discipline", 2], ["employee", 2], ["hiring", 2], ["termination", 2], ["hr", 1]],
  payroll_salary: [["payroll", 3], ["salary", 3], ["salaries", 3], ["wages", 3], ["compensation", 2], ["overtime", 2], ["pension", 2]],
  contracts_procurement: [["contract", 3], ["contracts", 3], ["procurement", 3], ["rfp", 3], ["bid", 2], ["vendor", 2], ["invoice", 2], ["purchase", 1]],
  budget_financial: [["budget", 3], ["expenditure", 3], ["revenue", 2], ["audit", 2], ["financial", 2], ["spending", 2], ["grant", 1]],
  building_permits: [["permit", 3], ["permits", 3], ["occupancy", 3], ["construction", 2], ["renovation", 2], ["building", 2], ["certificate", 1]],
  code_enforcement: [["enforcement", 3], ["violation", 3], ["nuisance", 3], ["abatement", 3], ["blight", 3], ["code", 2], ["citation", 1]],
  inspections: [["inspection", 3], ["inspections", 3], ["inspector", 3], ["compliance", 2], ["safety", 1]],
  zoning_planning: [["zoning", 3], ["rezoning", 3], ["variance", 3], ["subdivision", 3], ["planning", 2], ["development", 2], ["commission", 1]],
  property_records: [["deed", 3], ["parcel", 3], ["easement", 3], ["assessment", 2], ["title", 2], ["property", 2], ["tax", 1]],
  business_licenses: [["license", 3], ["licenses", 3], ["licensing", 3], ["cannabis", 3], ["liquor", 3], ["business", 1], ["vendor", 1]],
  meeting_minutes: [["minutes", 3], ["agenda", 3], ["meeting", 2], ["hearing", 2], ["council", 1], ["board", 1]],
  ordinances_resolutions: [["ordinance", 3], ["resolution", 3], ["municipal", 2], ["statute", 2], ["regulation", 2]],
  email_correspondence: [["email", 3], ["emails", 3], ["correspondence", 3], ["communications", 2], ["messages", 2], ["text", 1]],
  litigation_claims: [["litigation", 3], ["lawsuit", 3], ["settlement", 3], ["claim", 2], ["claims", 2], ["attorney", 2], ["legal", 1]],
  public_works_infrastructure: [["paving", 3], ["sidewalk", 3], ["sewer", 3], ["infrastructure", 3], ["street", 2], ["streets", 2], ["road", 2], ["roads", 2], ["repair", 1], ["maintenance", 1]],
  utilities: [["utility", 3], ["utilities", 3], ["meter", 3], ["electric", 2], ["water", 2], ["gas", 2], ["billing", 1]],
  transit: [["transit", 3], ["bus", 3], ["rail", 3], ["transportation", 2], ["parking", 2], ["traffic", 2]],
  parks_recreation: [["playground", 3], ["trail", 3], ["recreation", 3], ["park", 2], ["parks", 2], ["pool", 2]],
  animal_control: [["animal", 3], ["animals", 3], ["euthanasia", 3], ["shelter", 2], ["dog", 2], ["adoption", 1]],
  health_safety: [["restaurant", 3], ["sanitation", 3], ["disease", 3], ["food", 2], ["health", 2], ["hazard", 1]],
  elections: [["election", 3], ["elections", 3], ["ballot", 3], ["voter", 3], ["candidate", 2], ["campaign", 2]],
  education_student: [["student", 3], ["teacher", 3], ["curriculum", 3], ["enrollment", 3], ["school", 2]],
};

/** A match needs at least one defining term, or several corroborating ones. */
const MIN_TOPIC_SCORE = 3;

export const ALL_TOPIC_CODES = Object.keys(TOPIC_TERMS) as TopicCode[];

/** Platform-defined department roles — never a tenant's department name or id. */
export type DepartmentRole =
  | "police"
  | "fire"
  | "public_works"
  | "clerk"
  | "finance"
  | "human_resources"
  | "legal"
  | "planning"
  | "parks"
  | "health"
  | "utilities"
  | "transit"
  | "education"
  | "executive";

/**
 * Trigger terms per role, matched as SUBSTRINGS of the department name.
 *
 * Two rules learned the hard way, both worth keeping:
 *  1. Always use the SHORTER/singular form — `"street maintenance"` does not
 *     contain `"streets"`, but `"streets division"` does contain `"street"`.
 *     A plural trigger silently fails to match the singular name.
 *  2. Avoid short generic words that appear inside unrelated ones (`"law"`
 *     matches "Lawn Maintenance"; `"road"` matches "Broadway"). Prefer the
 *     multi-word phrase — a false role is worse than no role, because no
 *     role merely drops the route while a false one mis-files it.
 */
const ROLE_TERMS: Record<DepartmentRole, [string, number][]> = {
  police: [["police", 3], ["sheriff", 3], ["law enforcement", 3], ["public safety", 2]],
  fire: [["fire", 3], ["ems", 3], ["paramedic", 3], ["rescue", 2]],
  public_works: [["public works", 3], ["sanitation", 3], ["engineering", 3], ["infrastructure", 2], ["street", 2], ["works", 1]],
  // "records" is weak on purpose: "Police Records" is a police department,
  // and weighting by term LENGTH (an earlier version) got that backwards.
  clerk: [["clerk", 3], ["recorder", 3], ["secretary", 2], ["records", 1]],
  finance: [["finance", 3], ["treasurer", 3], ["accounting", 3], ["auditor", 3], ["budget", 2]],
  human_resources: [["human resources", 3], ["personnel", 3], ["employment", 2], ["hr", 2]],
  legal: [["attorney", 3], ["counsel", 3], ["law department", 3], ["legal", 2]],
  planning: [["planning", 3], ["zoning", 3], ["permit", 2], ["development", 2], ["building", 2]],
  parks: [["recreation", 3], ["park", 3], ["community services", 2]],
  health: [["health", 3], ["human services", 2], ["social services", 2]],
  utilities: [["utility", 3], ["utilities", 3], ["sewer", 3], ["electric", 2], ["water", 2], ["power", 2]],
  transit: [["transit", 3], ["transportation", 3], ["traffic", 2], ["parking", 2]],
  education: [["school", 3], ["education", 3]],
  executive: [["mayor", 3], ["administrator", 3], ["executive", 2], ["manager", 2], ["council", 2]],
};

const norm = (s: string) => s.toLowerCase().trim();

/**
 * Map a play's keywords onto exactly one topic code, or null.
 *
 * Deterministic and CONSERVATIVE: the winner must strictly beat the
 * runner-up. A tie is ambiguity, and a guessed mapping is a wrong mapping —
 * so ties drop. Dropping is always safe; mis-filing an agency's practice
 * under the wrong topic pollutes every other agency's benchmark.
 */
export function toTopicCode(keywords: readonly string[]): TopicCode | null {
  const terms = new Set(keywords.map(norm).filter(Boolean));
  if (terms.size === 0) return null;

  let best: { code: TopicCode; score: number } | null = null;
  let runnerUp = 0;
  // Stable iteration order (object key order is insertion order) keeps this
  // deterministic for equal scores — though equal scores drop anyway.
  for (const code of ALL_TOPIC_CODES) {
    let score = 0;
    for (const [term, weight] of TOPIC_TERMS[code]) if (terms.has(term)) score += weight;
    if (!best || score > best.score) {
      if (best) runnerUp = best.score;
      best = { code, score };
    } else if (score > runnerUp) {
      runnerUp = score;
    }
  }
  if (!best || best.score < MIN_TOPIC_SCORE) return null;
  return best.score > runnerUp ? best.code : null;
}

/** Map a tenant's department NAME onto a platform role, or null. */
export function toDepartmentRole(departmentName: string | null | undefined): DepartmentRole | null {
  if (!departmentName) return null;
  const name = norm(departmentName);
  if (!name) return null;

  let best: { role: DepartmentRole; score: number } | null = null;
  let runnerUp = 0;
  for (const role of Object.keys(ROLE_TERMS) as DepartmentRole[]) {
    let score = 0;
    for (const [term, weight] of ROLE_TERMS[role]) if (name.includes(term)) score += weight;
    if (!best || score > best.score) {
      if (best) runnerUp = best.score;
      best = { role, score };
    } else if (score > runnerUp) {
      runnerUp = score;
    }
  }
  if (!best || best.score === 0) return null;
  return best.score > runnerUp ? best.role : null;
}

/**
 * Map a staff-authored exemption label onto a canonical statute section.
 *
 * LOAD-BEARING: `reviews.exemptionLabel` is free text — redactionService
 * builds it as `reasons.join("; ")`, i.e. whatever a clerk typed. It can
 * contain a name, an address, a case number. It must NEVER cross a tenant
 * boundary. Only a section that appears in the agency's own statute profile
 * (already public law, already a fixed list) may cross, and only when the
 * label unambiguously names it.
 */
export function toStatuteSection(
  label: string | null | undefined,
  profileExemptions: readonly { statuteSection: string; shortLabel: string }[],
): string | null {
  if (!label) return null;
  const text = norm(label);
  if (!text) return null;

  const hits = new Set<string>();
  for (const e of profileExemptions) {
    const section = norm(e.statuteSection);
    const short = norm(e.shortLabel);
    if (section && text.includes(section)) hits.add(e.statuteSection);
    else if (short && text.includes(short)) hits.add(e.statuteSection);
  }
  // Exactly one match, or nothing. An ambiguous label is dropped rather than
  // attributed to a section the agency may not have cited.
  return hits.size === 1 ? [...hits][0]! : null;
}
