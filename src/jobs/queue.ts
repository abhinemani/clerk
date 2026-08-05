/**
 * Job queue (spec §4) — background work behind an adapter interface.
 *
 * DURABLE since 2026-08-04: every enqueue is a row in the `jobs` table before
 * anything runs, so a restart loses nothing — the worker picks queued rows
 * back up at boot (and re-queues rows a dead process left "running").
 * Retries with backoff; terminal failures STAY in the table where the
 * operator health surface can show them, instead of vanishing into a log.
 *
 * Works identically on embedded PGlite and managed Postgres (the claim uses
 * SELECT … FOR UPDATE SKIP LOCKED, so even multi-instance deployments are
 * safe). pg-boss remains a drop-in swap behind this same interface if a
 * deployment ever outgrows the built-in worker.
 */
import type { JobRecord, Repository } from "@/services/repository";

export type JobKind =
  | "intake_triage"
  | "exemption_pass"
  | "embed_public_documents"
  | "embed_document_chunks"
  | "ocr_extract"
  | "classify_documents";

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
  /** Records-import hints: suggested public/internal for the publication queue. */
  classify_documents: { agencyId: string; documentIds: string[] };
}

export type JobHandler<K extends JobKind = JobKind> = (payload: JobPayloads[K]) => Promise<void>;

export interface JobQueue {
  enqueue<K extends JobKind>(kind: K, payload: JobPayloads[K]): void;
}

const RETRY_BACKOFF_MS = 30_000; // × attempt number
const POLL_INTERVAL_MS = 1_500;

export class DurableQueue implements JobQueue {
  private handlers = new Map<JobKind, JobHandler>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private pendingPersists: Promise<void>[] = [];

  constructor(private readonly repoProvider: () => Promise<Repository>) {}

  register<K extends JobKind>(kind: K, handler: JobHandler<K>): void {
    this.handlers.set(kind, handler as JobHandler);
  }

  enqueue<K extends JobKind>(kind: K, payload: JobPayloads[K]): void {
    // Persist FIRST (durability), then nudge the worker so dev latency stays
    // sub-second. Fire-and-forget by contract; flush() awaits in tests.
    const p = this.persist(kind, payload)
      .then(() => void this.tick())
      .catch((err) => console.error(`[jobs] enqueue ${kind} failed to persist`, err));
    this.pendingPersists.push(p);
    if (this.pendingPersists.length > 50) this.pendingPersists.splice(0, 25);
  }

  private async persist(kind: JobKind, payload: Record<string, unknown>): Promise<void> {
    const repo = await this.repoProvider();
    await repo.createJob({
      id: crypto.randomUUID(),
      kind,
      payload,
      status: "queued",
      attempts: 0,
      maxAttempts: 3,
      lastError: null,
      runAfter: new Date(),
      createdAt: new Date(),
    });
  }

  /** Await all in-flight enqueues (tests + graceful moments). */
  async flush(): Promise<void> {
    await Promise.allSettled(this.pendingPersists);
  }

  /** Boot: recover orphaned "running" rows, then start polling. */
  async recoverAndStart(): Promise<void> {
    try {
      const repo = await this.repoProvider();
      const recovered = await repo.resetRunningJobs();
      if (recovered > 0) console.log(`[jobs] recovered ${recovered} job(s) from a previous process`);
    } catch (err) {
      console.error("[jobs] boot recovery failed", err);
    }
    if (!this.timer) {
      this.timer = setInterval(() => void this.tick(), POLL_INTERVAL_MS);
      // Don't hold a dev process open just to poll.
      this.timer.unref?.();
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One worker pass: claim → run → complete/retry/fail. Reentrancy-guarded. */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const repo = await this.repoProvider();
      // Drain everything runnable — each claim is atomic, so this is safe
      // even with another instance draining concurrently.
      for (;;) {
        const job = await repo.claimNextJob(new Date());
        if (!job) break;
        await this.run(repo, job);
      }
    } catch (err) {
      console.error("[jobs] worker tick failed", err);
    } finally {
      this.ticking = false;
    }
  }

  private async run(repo: Repository, job: JobRecord): Promise<void> {
    const handler = this.handlers.get(job.kind as JobKind);
    if (!handler) {
      // A row from a newer/older deploy — fail it visibly rather than loop.
      await repo.markJobFailed(job.id, `no handler registered for "${job.kind}"`, new Date());
      return;
    }
    try {
      await handler(job.payload as JobPayloads[JobKind]);
      await repo.completeJob(job.id, new Date());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (job.attempts >= job.maxAttempts) {
        console.error(`[jobs] ${job.kind} failed terminally after ${job.attempts} attempts`, err);
        await repo.markJobFailed(job.id, message, new Date());
      } else {
        console.error(`[jobs] ${job.kind} failed (attempt ${job.attempts}) — will retry`, err);
        await repo.retryJob(job.id, message, new Date(Date.now() + RETRY_BACKOFF_MS * job.attempts));
      }
    }
  }
}

interface QueueGlobal {
  __clerkJobQueue?: DurableQueue;
}
const g = globalThis as QueueGlobal;

export function getJobQueue(): DurableQueue {
  if (!g.__clerkJobQueue) {
    g.__clerkJobQueue = new DurableQueue(async () => {
      const { getRepository } = await import("@/db/createRepository");
      return getRepository();
    });
  }
  return g.__clerkJobQueue;
}
