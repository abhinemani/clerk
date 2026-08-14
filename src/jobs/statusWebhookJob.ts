/**
 * Status-webhook delivery (docs/agentic-horizon.md — status API + webhooks).
 * Durable on purpose: a subscriber being down becomes a retried job and,
 * terminally, a visible failure on /admin Health — never a silent drop.
 *
 * The POST is a PING (see statusApiService): tracking-number-level facts +
 * a pointer to the status API, which is the source of truth. At-least-once
 * delivery; subscribers should treat pings as idempotent.
 */
import { getRepository } from "@/db/createRepository";
import type { JobPayloads } from "./queue";

const TIMEOUT_MS = 10_000;

export async function runDeliverStatusWebhookJob(
  payload: JobPayloads["deliver_status_webhook"],
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const repo = await getRepository();
  const agency = await repo.getAgency(payload.agencyId);
  // Setting removed (or agency gone) between enqueue and delivery → done.
  const url = agency?.settings?.statusApi?.webhookUrl;
  if (!agency || !url) return;

  const base = process.env.APP_BASE_URL ?? "";
  const body = {
    event: payload.event,
    publicId: payload.publicId,
    ...(payload.to ? { to: payload.to } : {}),
    ...(payload.dueAt ? { dueAt: payload.dueAt } : {}),
    occurredAt: payload.occurredAt,
    agency: agency.slug,
    // The authoritative record — subscribers verify here, not off the ping.
    statusUrl: `${base}/api/v1/${agency.slug}/requests/${encodeURIComponent(payload.publicId)}`,
  };

  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "brandeis-status-webhook" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`status webhook delivery failed: ${res.status} ${url}`);
  }
}
