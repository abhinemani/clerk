/**
 * Demo scheduling (pure).
 *
 * The marketing site's second call to action lands here: a jurisdiction asks
 * for a walkthrough and says when it can take one. There is no calendar
 * integration and deliberately no third-party scheduler in the default path
 * (self-contained first) — the form collects *availability*, an operator
 * confirms a time by replying. A deployment that has a real booking page
 * points DEMO_SCHEDULING_URL at it and the page offers that too; the form
 * still works when it is unset, which is the normal case.
 *
 * Everything here is a pure function over the submitted fields so the server
 * action stays a thin shell: validate → persist → (best effort) notify.
 */

/** Weekday preference. Records offices are a weekday business; no weekends. */
export const DEMO_DAYS = [
  { value: "mon", label: "Monday" },
  { value: "tue", label: "Tuesday" },
  { value: "wed", label: "Wednesday" },
  { value: "thu", label: "Thursday" },
  { value: "fri", label: "Friday" },
] as const;

/** Coarse windows, in the requester's OWN timezone — see `timezone`. */
export const DEMO_WINDOWS = [
  { value: "morning", label: "Morning (8–11)" },
  { value: "midday", label: "Midday (11–2)" },
  { value: "afternoon", label: "Afternoon (2–5)" },
] as const;

/** US zones plus an escape hatch; the label is what an operator reads. */
export const DEMO_TIMEZONES = [
  { value: "ET", label: "Eastern" },
  { value: "CT", label: "Central" },
  { value: "MT", label: "Mountain" },
  { value: "PT", label: "Pacific" },
  { value: "AKHT", label: "Alaska / Hawai‘i" },
  { value: "other", label: "Somewhere else" },
] as const;

export type DemoDay = (typeof DEMO_DAYS)[number]["value"];
export type DemoWindow = (typeof DEMO_WINDOWS)[number]["value"];
export type DemoTimezone = (typeof DEMO_TIMEZONES)[number]["value"];

export interface DemoRequestInput {
  name: string;
  email: string;
  organization: string;
  role?: string;
  stateCode?: string;
  days: string[];
  windows: string[];
  timezone: string;
  note?: string;
}

export interface DemoRequestFields {
  name: string;
  email: string;
  organization: string;
  role: string | null;
  stateCode: string | null;
  days: DemoDay[];
  windows: DemoWindow[];
  timezone: DemoTimezone;
  note: string | null;
}

export type DemoRequestParse =
  | { ok: true; value: DemoRequestFields }
  | { ok: false; error: string };

// Long enough for a real note, short enough that the field is not a paste
// target for a novel. Truncation would silently drop meaning, so it refuses.
const MAX_NOTE = 1000;
const MAX_SHORT = 120;

const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

function clean(v: string | undefined): string {
  return (v ?? "").trim().replace(/\s+/g, " ");
}

// Walk the ALLOWED list, not the submitted one: unknown values fall away and
// the result is always in canonical order (Mon→Fri, morning→afternoon), with
// duplicates collapsed. Two identical availabilities then read identically.
function pick<T extends string>(raw: string[], allowed: readonly { value: T }[]): T[] {
  return allowed.map((a) => a.value).filter((v) => raw.includes(v));
}

/**
 * Validate a submission. Every failure is a sentence a person can act on —
 * this is the public front door of the product and a curt "invalid input"
 * costs a lead.
 */
export function parseDemoRequest(input: DemoRequestInput): DemoRequestParse {
  const name = clean(input.name);
  const email = clean(input.email).toLowerCase();
  const organization = clean(input.organization);
  const role = clean(input.role);
  const note = (input.note ?? "").trim();

  if (!name) return { ok: false, error: "Add your name so we know who we're meeting." };
  if (name.length > MAX_SHORT) return { ok: false, error: "That name is too long." };
  if (!EMAIL.test(email)) return { ok: false, error: "That email address doesn't look right." };
  if (email.length > MAX_SHORT) return { ok: false, error: "That email address is too long." };
  if (!organization) {
    return { ok: false, error: "Tell us which jurisdiction or organization you're with." };
  }
  if (organization.length > MAX_SHORT) return { ok: false, error: "That organization name is too long." };
  if (role.length > MAX_SHORT) return { ok: false, error: "That title is too long." };
  if (note.length > MAX_NOTE) {
    return { ok: false, error: "Please keep the note under 1,000 characters." };
  }

  const days = pick<DemoDay>(input.days ?? [], DEMO_DAYS);
  const windows = pick<DemoWindow>(input.windows ?? [], DEMO_WINDOWS);
  if (days.length === 0) return { ok: false, error: "Pick at least one day that works." };
  if (windows.length === 0) return { ok: false, error: "Pick at least one time of day." };

  const timezone = DEMO_TIMEZONES.some((t) => t.value === input.timezone)
    ? (input.timezone as DemoTimezone)
    : null;
  if (!timezone) return { ok: false, error: "Choose your time zone." };

  const stateCode = clean(input.stateCode).toUpperCase();

  return {
    ok: true,
    value: {
      name,
      email,
      organization,
      role: role || null,
      stateCode: /^[A-Z]{2}$/.test(stateCode) ? stateCode : null,
      days,
      windows,
      timezone,
      note: note || null,
    },
  };
}

/** "Mon, Wed · mornings, afternoons · Pacific" — one line for an operator. */
export function describeAvailability(f: {
  days: string[];
  windows: string[];
  timezone: string;
}): string {
  const dayLabels = DEMO_DAYS.filter((d) => f.days.includes(d.value)).map((d) =>
    d.label.slice(0, 3),
  );
  const windowLabels = DEMO_WINDOWS.filter((w) => f.windows.includes(w.value)).map((w) =>
    w.label.replace(/\s*\(.*\)$/, "").toLowerCase(),
  );
  const zone = DEMO_TIMEZONES.find((t) => t.value === f.timezone)?.label ?? f.timezone;
  return `${dayLabels.join(", ")} · ${windowLabels.join(", ")} · ${zone}`;
}

/** The operator notification body. Plain text on purpose (email adapter). */
export function demoRequestEmail(fields: DemoRequestFields): { subject: string; text: string } {
  return {
    subject: `Walkthrough request — ${fields.organization}`,
    text: [
      `${fields.name}${fields.role ? `, ${fields.role}` : ""}`,
      `${fields.organization}${fields.stateCode ? ` (${fields.stateCode})` : ""}`,
      fields.email,
      "",
      `Available: ${describeAvailability(fields)}`,
      ...(fields.note ? ["", fields.note] : []),
      "",
      "Reply to this person directly to confirm a time.",
    ].join("\n"),
  };
}
