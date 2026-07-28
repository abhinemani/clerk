/**
 * Job registration + boot-time schedules. Called once per server process from
 * instrumentation.ts (idempotent via the globalThis-memoized queue).
 */
import { getJobQueue } from "./queue";
import { runIntakeTriageJob } from "./triageJob";

interface RegisterGlobal {
  __clerkJobsRegistered?: boolean;
  __clerkSweepTimer?: ReturnType<typeof setInterval>;
}
const g = globalThis as RegisterGlobal;

const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function registerJobs(): void {
  if (g.__clerkJobsRegistered) return;
  g.__clerkJobsRegistered = true;

  const queue = getJobQueue();
  queue.register("intake_triage", runIntakeTriageJob);

  // Nightly deadline sweep (§16.1): the deadline agent's digest lands in each
  // agency's append-only admin log, whether or not anyone opens the app.
  const sweep = async () => {
    try {
      const [{ getRepository }, { runDeadlineSweep }] = await Promise.all([
        import("@/db/createRepository"),
        import("@/agents/deadlineAgent"),
      ]);
      const repo = await getRepository();
      const agencies = await repo.listAgencies();
      for (const agency of agencies) {
        const [requests, tasks] = await Promise.all([
          repo.listRequests(agency.id),
          repo.listAgencyTasks(agency.id),
        ]);
        if (requests.length === 0) continue;
        const openByRequest = new Map<string, number>();
        for (const t of tasks) {
          if (t.status !== "done" && t.status !== "cancelled") {
            openByRequest.set(t.requestId, (openByRequest.get(t.requestId) ?? 0) + 1);
          }
        }
        const result = await runDeadlineSweep({
          now: new Date(),
          queue: requests.map((r) => ({
            publicId: r.publicId,
            dueAt: r.statutoryDueAt ?? new Date(r.createdAt.getTime() + 10 * 86_400_000),
            outstandingTasks: openByRequest.get(r.id) ?? 0,
            complexityScore: r.complexityScore ?? 0,
          })),
        });
        await repo.appendAdminEvent({
          id: crypto.randomUUID(),
          agencyId: agency.id,
          kind: "deadline_sweep",
          actorLabel: "deadline agent",
          summary: result.digest.split("\n")[0] ?? "Deadline sweep completed",
          payload: { digest: result.digest, outcome: result.outcome },
          createdAt: new Date(),
        });
      }
    } catch (err) {
      console.error("[jobs] deadline sweep failed", err);
    }
  };

  if (!g.__clerkSweepTimer) {
    g.__clerkSweepTimer = setInterval(sweep, SWEEP_INTERVAL_MS);
    // Also run shortly after boot so a restarted server has a fresh digest.
    setTimeout(sweep, 15_000);
  }
}
