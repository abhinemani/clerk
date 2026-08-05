/**
 * Service dependencies — the impure edges (clock, id/token generation) are
 * injected so use cases stay deterministic and unit-testable.
 */
import type { BlobStore } from "@/adapters/blobStore";
import { getEmailSender } from "@/adapters/email";
import type { Repository } from "./repository";
import { DbNotifier, RelayNotifier, type Notifier } from "./notifications";

export interface ServiceDeps {
  repo: Repository;
  now: () => Date;
  genId: () => string;
  genToken: () => string;
  /** Optional outbound delivery (email). When absent, dispatches mint the link but send nothing. */
  notifier?: Notifier;
  /** Object storage — required by use cases that mint artifacts (redaction burn). */
  blobStore?: BlobStore;
  /** Agency display name + base URL for notification bodies/links. */
  agencyName?: string;
  baseUrl?: string;
}

/** Production defaults: real clock, random UUIDs, url-safe tokens, DB outbox. */
export function defaultDeps(repo: Repository): ServiceDeps {
  // Deliveries always land in the outbox (the audit of who was told what).
  // With an email provider configured (EMAIL_FROM + POSTMARK_SERVER_TOKEN or
  // RESEND_API_KEY), RelayNotifier also delivers for real.
  const outbox = new DbNotifier(repo);
  const sender = getEmailSender();
  return {
    repo,
    now: () => new Date(),
    genId: () => crypto.randomUUID(),
    genToken: () => crypto.randomUUID().replace(/-/g, "").slice(0, 20),
    notifier: sender ? new RelayNotifier(outbox, sender, repo) : outbox,
    baseUrl: process.env.APP_BASE_URL,
  };
}
