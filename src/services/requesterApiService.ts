/**
 * Requester API (docs/requester-api.md) — the machine door onto the portal's
 * PUBLIC surface: archive search, record reads, status by tracking number,
 * and (separately gated) filing. Two rules carry everything:
 *
 * 1. PROJECTION ONLY. Every byte served already flows through a portal page
 *    an anonymous visitor can load — archive search (invariant 3 hard-scopes
 *    it to classification='public' in the query layer), record permalinks,
 *    and the tracker projection. Enabling the API never widens what a
 *    requester can see.
 *
 * 2. FILING IS THE REAL THING. file_request rides the exact portal chain
 *    (intakeService.submitAndDispatch): real public id, statutory deadline,
 *    audit events, routing, triage. Which is why it is separately gated and
 *    rate-limited — a machine can file faster than a form.
 */
import { SignupRateLimiter } from "@/domain/signupPolicy";
import type { ServiceDeps } from "./deps";
import { submitAndDispatch } from "./intakeService";
import type { Agency } from "./repository";

export interface RequesterApiConfig {
  enabled: boolean;
  filingEnabled: boolean;
}

/** The one reading of the opt-in: absent/off ⇒ everything plays dead (404). */
export function requesterApiConfig(agency: Agency | null | undefined): RequesterApiConfig {
  const s = agency?.settings?.requesterApi;
  return {
    enabled: s?.enabled === true,
    filingEnabled: s?.enabled === true && s?.filingEnabled !== false,
  };
}

/**
 * Filing rate limit — fixed window, in-memory (a restart resets it; for an
 * anti-flood guard that is fine, same posture as signup). Keyed per
 * agency+client so one noisy agent can't exhaust another tenant's window.
 */
export const FILING_LIMIT = { windowMs: 60 * 60 * 1000, maxPerKey: 5, maxGlobal: 200 };
export const filingLimiter = new SignupRateLimiter(FILING_LIMIT);

/** Best-effort client key: first forwarded hop, else a shared bucket. */
export function apiClientKey(headers: Headers, slug: string): string {
  const fwd = headers.get("x-forwarded-for");
  const ip = fwd?.split(",")[0]?.trim() || headers.get("x-real-ip")?.trim() || "unknown";
  return `${slug}:${ip}`;
}

export type FileViaApiResult =
  | { ok: true; publicId: string; dueAtISO: string | null }
  | { ok: false; error: string };

export async function fileViaApi(
  deps: ServiceDeps,
  input: { agencyId: string; text: string; name?: string; email?: string },
  /** Test seam, threaded to intakeService (emitStatusWebhook idiom). */
  enqueueOverride?: Parameters<typeof submitAndDispatch>[2],
): Promise<FileViaApiResult> {
  const rawText = input.text?.trim() ?? "";
  if (rawText.length < 3) {
    return { ok: false, error: "Describe the records you are looking for (at least a few words)." };
  }
  try {
    const request = await submitAndDispatch(
      deps,
      {
        agencyId: input.agencyId,
        rawText,
        requester: {
          email: input.email?.trim() || undefined,
          name: input.name?.trim() || undefined,
        },
      },
      enqueueOverride,
    );
    return {
      ok: true,
      publicId: request.publicId,
      dueAtISO: request.statutoryDueAt?.toISOString() ?? null,
    };
  } catch (e) {
    console.error("fileViaApi failed", e);
    return { ok: false, error: "Filing failed. Please try again." };
  }
}
