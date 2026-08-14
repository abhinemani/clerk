/**
 * Requester status API + status webhooks (docs/agentic-horizon.md, the
 * "non-agent functionality worth roadmapping" list): the first brick of the
 * §16.4 agent-to-agent surface, useful to newsrooms today.
 *
 * TWO RULES CARRY EVERYTHING HERE:
 *
 * 1. The API exposes EXACTLY the tracker's projection — what anyone holding
 *    a tracking number already sees on /[slug]/track. Nothing about the
 *    requester, no raw filing text, no staff names, no correspondence
 *    (tracking numbers are guessable; the thread never travels on the number
 *    alone). Milestones are status_change + extension events ONLY.
 *
 * 2. Webhooks are PINGS, not payloads of record. The POST carries the same
 *    tracking-number-level facts plus a pointer to the status API; a
 *    subscriber who cares verifies against the API. That is why there is no
 *    signing secret: nothing worth forging rides the ping, and the house
 *    rule that no secret value reaches the database stays intact.
 *
 * Both are per-agency opt-in (settings.statusApi) — same posture as the
 * public transparency log.
 */
import { requestStatusLabel } from "@/lib/format";
import type { ServiceDeps } from "./deps";
import type { Repository } from "./repository";

export interface PublicRequestStatus {
  publicId: string;
  status: string;
  statusLabel: string;
  receivedAt: string;
  dueAt: string | null;
  closedAt: string | null;
  extension: { days: number; reason: string; at: string } | null;
  timeline: { label: string; at: string }[];
  /** Released files — the download gate re-enforces who may actually fetch. */
  artifacts: { filename: string; url: string }[];
  forwardedTo: { agencyName: string; publicId: string } | null;
}

/**
 * The requester-safe projection for one request, by tracking number.
 * Returns null for unknown ids — the route turns that into a 404.
 */
export async function publicRequestStatus(
  repo: Repository,
  input: { agencyId: string; agencySlug: string; publicId: string },
): Promise<PublicRequestStatus | null> {
  const request = await repo.findRequestByPublicId(
    input.agencyId,
    input.publicId.trim().toUpperCase(),
  );
  if (!request) return null;

  const taken = request.extensionHistory?.[0];
  const events = await repo.listEvents(input.agencyId, request.id);
  const timeline = events
    .filter((e) => e.kind === "status_change" || e.kind === "extension")
    .map((e) => ({
      label:
        e.kind === "extension"
          ? `Response deadline extended${taken ? ` by ${taken.days} days` : ""}`
          : typeof e.payload?.to === "string"
            ? requestStatusLabel(e.payload.to as string)
            : e.summary,
      at: e.createdAt.toISOString(),
    }));

  let artifacts: PublicRequestStatus["artifacts"] = [];
  if (request.status === "fulfilled" || request.status === "partially_fulfilled") {
    const releases = await repo.listReleases(input.agencyId, request.id);
    artifacts = releases.flatMap((rel) =>
      rel.artifacts
        .filter((a) => a.documentId)
        .map((a) => ({ filename: a.filename, url: `/${input.agencySlug}/files/${a.documentId}` })),
    );
  }

  return {
    publicId: request.publicId,
    status: request.status,
    statusLabel: requestStatusLabel(request.status),
    receivedAt: (request.receivedAt ?? request.createdAt).toISOString(),
    dueAt: request.statutoryDueAt?.toISOString() ?? null,
    closedAt: request.closedAt?.toISOString() ?? null,
    extension: taken
      ? { days: taken.days, reason: taken.reason, at: new Date(taken.at).toISOString() }
      : null,
    timeline,
    artifacts,
    forwardedTo: request.forwardedTo
      ? { agencyName: request.forwardedTo.agencyName, publicId: request.forwardedTo.publicId }
      : null,
  };
}

export type StatusWebhookEvent = "status_changed" | "deadline_extended";

export interface StatusWebhookPayload {
  agencyId: string;
  publicId: string;
  event: StatusWebhookEvent;
  /** New status for status_changed; absent for deadline_extended. */
  to?: string;
  /** New statutory deadline for deadline_extended (ISO). */
  dueAt?: string;
  occurredAt: string;
}

type Enqueue = (kind: "deliver_status_webhook", payload: StatusWebhookPayload) => void;

/**
 * Fire-and-forget webhook emit — called from every code path that moves a
 * request's status (there are seven; see the site list in the tests) plus
 * extendRequest. NEVER throws and never blocks the legal action: a webhook
 * is telemetry about the record, not part of it. No-op unless the agency
 * opted in with a webhook URL; delivery itself is a durable job so failures
 * land on /admin Health.
 */
export async function emitStatusWebhook(
  deps: ServiceDeps,
  input: {
    agencyId: string;
    publicId: string;
    event: StatusWebhookEvent;
    to?: string;
    dueAt?: Date | null;
  },
  enqueueOverride?: Enqueue,
): Promise<void> {
  try {
    const agency = await deps.repo.getAgency(input.agencyId);
    const url = agency?.settings?.statusApi?.webhookUrl;
    if (!url) return;
    const payload: StatusWebhookPayload = {
      agencyId: input.agencyId,
      publicId: input.publicId,
      event: input.event,
      ...(input.to ? { to: input.to } : {}),
      ...(input.dueAt ? { dueAt: input.dueAt.toISOString() } : {}),
      occurredAt: deps.now().toISOString(),
    };
    if (enqueueOverride) {
      enqueueOverride("deliver_status_webhook", payload);
    } else {
      const { getJobQueue } = await import("@/jobs/queue");
      getJobQueue().enqueue("deliver_status_webhook", payload);
    }
  } catch (e) {
    console.error("[statusApi] webhook emit failed (non-fatal)", e);
  }
}
