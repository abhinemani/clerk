/**
 * Walkthrough-request validation (pure).
 *
 * The marketing site's primary CTA is the one form a logged-out stranger can
 * submit, so this module is deliberately boring: normalize, bound every
 * field's length, and require only what a human needs to actually call them
 * back (who, where, how to reach them). Everything else is optional — an
 * evaluating clerk should never be interrogated by a contact form.
 *
 * No spam heuristics beyond length bounds and a honeypot check: the write
 * path rate-limits (SignupRateLimiter, same as /signup), and a junk row in a
 * platform-level table costs nothing. Guessing at "is this a real person"
 * would turn away the same edge-case governments the signup gate used to
 * (see signupPolicy.ts) — a records officer at a joint-powers authority with
 * a personal address is exactly who we want to hear from.
 */

export interface DemoRequestInput {
  name: string;
  email: string;
  organization: string;
  role?: string;
  stateCode?: string;
  notes?: string;
  source?: string;
  /** Hidden field: real humans leave it empty, naive bots fill it in. */
  honeypot?: string;
}

export interface NormalizedDemoRequest {
  name: string;
  email: string;
  organization: string;
  role: string | null;
  stateCode: string | null;
  notes: string | null;
  source: string | null;
}

export const DEMO_FIELD_LIMITS = {
  name: 120,
  email: 200,
  organization: 160,
  role: 120,
  notes: 2000,
  source: 60,
} as const;

/** Deliberately permissive: one @, no spaces, a dot in the domain. */
export function looksLikeEmail(value: string): boolean {
  const email = value.trim();
  if (email.length < 5 || email.length > DEMO_FIELD_LIMITS.email) return false;
  if (/\s/.test(email)) return false;
  const at = email.lastIndexOf("@");
  if (at < 1 || at === email.length - 1) return false;
  const domain = email.slice(at + 1);
  return domain.includes(".") && !domain.startsWith(".") && !domain.endsWith(".");
}

export type DemoRequestValidation =
  | { ok: true; value: NormalizedDemoRequest }
  | { ok: false; error: string };

const trim = (v: string | undefined, max: number): string => (v ?? "").trim().slice(0, max);
const orNull = (v: string): string | null => (v.length > 0 ? v : null);

export function validateDemoRequest(input: DemoRequestInput): DemoRequestValidation {
  // Bots first: a filled honeypot is reported as success to the caller's UI
  // but never stored, so a scraper learns nothing from the response.
  if ((input.honeypot ?? "").trim().length > 0) {
    return { ok: false, error: "__honeypot__" };
  }

  const name = trim(input.name, DEMO_FIELD_LIMITS.name);
  if (name.length < 2) return { ok: false, error: "Please enter your name." };

  const email = trim(input.email, DEMO_FIELD_LIMITS.email).toLowerCase();
  if (!looksLikeEmail(email)) return { ok: false, error: "Please enter a valid email address." };

  const organization = trim(input.organization, DEMO_FIELD_LIMITS.organization);
  if (organization.length < 2) {
    return { ok: false, error: "Please enter your agency or organization." };
  }

  // Validate the WHOLE value, never a slice of it: truncating first would
  // quietly turn "Texas" into "TE" and store a state that doesn't exist.
  const stateCode = (input.stateCode ?? "").trim().toUpperCase();

  return {
    ok: true,
    value: {
      name,
      email,
      organization,
      role: orNull(trim(input.role, DEMO_FIELD_LIMITS.role)),
      stateCode: /^[A-Z]{2}$/.test(stateCode) ? stateCode : null,
      notes: orNull(trim(input.notes, DEMO_FIELD_LIMITS.notes)),
      source: orNull(trim(input.source, DEMO_FIELD_LIMITS.source)),
    },
  };
}

/** True when the honeypot tripped — the caller should fake success. */
export function isHoneypotRejection(v: DemoRequestValidation): boolean {
  return !v.ok && v.error === "__honeypot__";
}

/**
 * The optional external scheduler (Calendly/Cal.com/…). Unset on a default
 * deployment — self-contained first: the built-in form is the real path and
 * this only redirects the CTA when an owner has actually set one up.
 */
export function schedulingUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = (env.DEMO_SCHEDULING_URL ?? "").trim();
  if (!raw) return null;
  // Only absolute http(s) — a relative or javascript: value would be a
  // redirect gadget on a public page.
  if (!/^https?:\/\//i.test(raw)) return null;
  return raw;
}
