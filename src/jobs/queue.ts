/**
 * Job queue (spec §4) — background work behind an adapter interface.
 *
 * The in-process implementation fits this app's turnkey deploy story (one
 * container, embedded PGlite): jobs run asynchronously off the request path
 * with one retry, and the queue is memoized on globalThis so Next's per-route
 * bundles share it. Multi-instance deployments swap in a pg-boss adapter
 * behind the same interface (pg-boss needs managed Postgres — it cannot run
 * on PGlite, which is also why it isn't the default here).
 */
export type JobKind =
  | "intake_triage"
  | "exemption_pass"
  | "embed_public_documents"
  | "embed_document_chunks"
  | "ocr_extract";

export interface JobPayloads {
  intake_triage: { agencyId: string; requestId: string };
  /** §6.5 step 2: LLM exemption suggestions for a request's review-set docs. */
  exemption_pass: { agencyId: string; requestId: string };
  /** §6.4/§6.7: embed public-archive docs that don't have vectors yet. */
  embed_public_documents: { agencyId: string };
  /** §6.5: OCR recovery for text-less scans/images (no-op when OCR is off). */
  ocr_extract: { agencyId: string; requestId?: string; documentId?: string };
  /** §6.4: body-chunk vectors for STAFF hybrid search (full corpus). */
  embed_document_chunks: { agencyId: string; documentId?: string };
}

export type JobHandler<K extends JobKind = JobKind> = (payload: JobPayloads[K]) => Promise<void>;

export interface JobQueue {
  enqueue<K extends JobKind>(kind: K, payload: JobPayloads[K]): void;
}

class InProcessQueue implements JobQueue {
  private handlers = new Map<JobKind, JobHandler>();

  register<K extends JobKind>(kind: K, handler: JobHandler<K>): void {
    this.handlers.set(kind, handler as JobHandler);
  }

  enqueue<K extends JobKind>(kind: K, payload: JobPayloads[K]): void {
    const handler = this.handlers.get(kind);
    if (!handler) {
      console.warn(`[jobs] no handler registered for ${kind} — dropping`);
      return;
    }
    // Off the request path; one retry with backoff, then log and move on
    // (the request itself is already persisted — a failed job is a missing
    // draft, not lost data).
    setTimeout(async () => {
      try {
        await handler(payload);
      } catch (err) {
        console.error(`[jobs] ${kind} failed, retrying once`, err);
        setTimeout(async () => {
          try {
            await handler(payload);
          } catch (err2) {
            console.error(`[jobs] ${kind} failed twice — giving up`, err2);
          }
        }, 5_000);
      }
    }, 10);
  }
}

interface QueueGlobal {
  __clerkJobQueue?: InProcessQueue;
}
const g = globalThis as QueueGlobal;

export function getJobQueue(): InProcessQueue {
  if (!g.__clerkJobQueue) g.__clerkJobQueue = new InProcessQueue();
  return g.__clerkJobQueue;
}
