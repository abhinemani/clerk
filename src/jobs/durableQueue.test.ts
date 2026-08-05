/**
 * Durable-queue tests: the whole point is that a restart loses nothing and
 * failures stay visible. Ticks are driven manually — no timers in tests.
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "@/services/repository";
import { DurableQueue, type JobPayloads } from "./queue";

function ctx() {
  const repo = new InMemoryRepository();
  const queue = new DurableQueue(async () => repo);
  return { repo, queue };
}

const PAYLOAD: JobPayloads["intake_triage"] = { agencyId: "ag-1", requestId: "r-1" };

describe("DurableQueue", () => {
  it("persists BEFORE running — an enqueued job is a row, then it runs", async () => {
    const { repo, queue } = ctx();
    const ran: unknown[] = [];
    queue.register("intake_triage", async (p) => {
      ran.push(p);
    });

    queue.enqueue("intake_triage", PAYLOAD);
    await queue.flush();
    await queue.tick();

    expect(ran).toEqual([PAYLOAD]);
    const jobs = await repo.listJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.status).toBe("done");
    expect(jobs[0]!.attempts).toBe(1);
  });

  it("survives a 'restart': a queued row runs once handlers re-register", async () => {
    const { repo, queue } = ctx();
    // No handler yet — simulates enqueue-then-crash (row persisted, nothing ran).
    await repo.createJob({
      id: "j-1", kind: "intake_triage", payload: PAYLOAD, status: "queued",
      attempts: 0, maxAttempts: 3, lastError: null, runAfter: new Date(0), createdAt: new Date(0),
    });

    // "New process": register + recover + tick.
    const ran: unknown[] = [];
    queue.register("intake_triage", async (p) => { ran.push(p); });
    await queue.recoverAndStart();
    queue.stop(); // no timers in tests
    await queue.tick();

    expect(ran).toEqual([PAYLOAD]);
    expect((await repo.listJobs({ status: "done" }))).toHaveLength(1);
  });

  it("re-queues rows a dead process left 'running'", async () => {
    const { repo, queue } = ctx();
    await repo.createJob({
      id: "j-1", kind: "intake_triage", payload: PAYLOAD, status: "running",
      attempts: 1, maxAttempts: 3, lastError: null, runAfter: new Date(0), createdAt: new Date(0),
    });
    queue.register("intake_triage", async () => {});
    await queue.recoverAndStart();
    queue.stop();
    await queue.tick();
    expect((await repo.listJobs({ status: "done" }))).toHaveLength(1);
  });

  it("retries with backoff, then fails TERMINALLY and stays visible", async () => {
    const { repo, queue } = ctx();
    let calls = 0;
    queue.register("intake_triage", async () => {
      calls++;
      throw new Error("model unavailable");
    });

    queue.enqueue("intake_triage", PAYLOAD);
    await queue.flush();
    await queue.tick(); // attempt 1 → retry scheduled in the future

    let [job] = await repo.listJobs();
    expect(job!.status).toBe("queued");
    expect(job!.runAfter.getTime()).toBeGreaterThan(Date.now()); // backoff

    // Fast-forward: make it runnable twice more (attempts 2 and 3 = max).
    await repo.retryJob(job!.id, "fast-forward", new Date(0));
    await queue.tick();
    [job] = await repo.listJobs();
    await repo.retryJob(job!.id, "fast-forward", new Date(0));
    await queue.tick();

    [job] = await repo.listJobs();
    expect(calls).toBe(3);
    expect(job!.status).toBe("failed"); // visible to the health surface
    expect(job!.lastError).toContain("model unavailable");
  });

  it("fails a row with no registered handler instead of looping on it", async () => {
    const { repo, queue } = ctx();
    await repo.createJob({
      id: "j-old", kind: "job_kind_from_a_future_deploy", payload: {}, status: "queued",
      attempts: 0, maxAttempts: 3, lastError: null, runAfter: new Date(0), createdAt: new Date(0),
    });
    await queue.tick();
    const [job] = await repo.listJobs();
    expect(job!.status).toBe("failed");
    expect(job!.lastError).toContain("no handler");
  });

  it("runs jobs oldest-first", async () => {
    const { repo, queue } = ctx();
    const order: string[] = [];
    queue.register("intake_triage", async (p) => {
      order.push((p as { requestId: string }).requestId);
    });
    await repo.createJob({
      id: "j-2", kind: "intake_triage", payload: { agencyId: "a", requestId: "second" },
      status: "queued", attempts: 0, maxAttempts: 3, lastError: null,
      runAfter: new Date(0), createdAt: new Date(2_000),
    });
    await repo.createJob({
      id: "j-1", kind: "intake_triage", payload: { agencyId: "a", requestId: "first" },
      status: "queued", attempts: 0, maxAttempts: 3, lastError: null,
      runAfter: new Date(0), createdAt: new Date(1_000),
    });
    await queue.tick();
    expect(order).toEqual(["first", "second"]);
  });
});
