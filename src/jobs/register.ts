/**
 * Job registration + boot-time schedules. Called once per server process from
 * instrumentation.ts (idempotent via the globalThis-memoized queue).
 */
import { runClassifyDocumentsJob } from "./classifyDocumentsJob";
import { runEmbedDocumentChunksJob } from "./chunkEmbedJob";
import { runEmbedPublicDocumentsJob } from "./embedJob";
import { runEmbedRequestsJob } from "./embedRequestsJob";
import { runExemptionPassJob } from "./exemptionPassJob";
import { runOcrExtractJob } from "./ocrJob";
import { getJobQueue } from "./queue";
import { runDeliverStatusWebhookJob } from "./statusWebhookJob";
import { runSyncConnectedSourceJob } from "./syncConnectedSourceJob";
import { runIntakeTriageJob } from "./triageJob";

interface RegisterGlobal {
  __brandeisJobsRegistered?: boolean;
  __brandeisSweepTimer?: ReturnType<typeof setInterval>;
}
const g = globalThis as RegisterGlobal;

const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function registerJobs(): void {
  if (g.__brandeisJobsRegistered) return;
  g.__brandeisJobsRegistered = true;

  const queue = getJobQueue();
  queue.register("intake_triage", runIntakeTriageJob);
  queue.register("exemption_pass", runExemptionPassJob);
  queue.register("embed_public_documents", runEmbedPublicDocumentsJob);
  queue.register("ocr_extract", runOcrExtractJob);
  queue.register("embed_document_chunks", runEmbedDocumentChunksJob);
  queue.register("classify_documents", runClassifyDocumentsJob);
  queue.register("sync_connected_source", runSyncConnectedSourceJob);
  queue.register("embed_requests", runEmbedRequestsJob);
  queue.register("deliver_status_webhook", runDeliverStatusWebhookJob);
  // Durable queue: re-queue rows a dead process left "running", then start
  // the polling worker. Jobs enqueued before a restart run after it.
  void queue.recoverAndStart();

  // Backfill archive embeddings shortly after boot (no-op when up to date;
  // fake embedder keeps this working without VOYAGE_API_KEY).
  setTimeout(async () => {
    try {
      const { getRepository } = await import("@/db/createRepository");
      const repo = await getRepository();
      for (const agency of await repo.listAgencies()) {
        queue.enqueue("embed_public_documents", { agencyId: agency.id });
        // Staff-search body vectors for the whole corpus (§6.4).
        queue.enqueue("embed_document_chunks", { agencyId: agency.id });
        // Ask vectors for the precedent corpus (answer-first phase 4) —
        // no-op once caught up; catches legacy imports and pre-phase-4 rows.
        queue.enqueue("embed_requests", { agencyId: agency.id });
      }
    } catch (err) {
      console.error("[jobs] embedding backfill enqueue failed", err);
    }
  }, 20_000);

  // Nightly deadline sweep (§16.1): the deadline agent's digest lands in each
  // agency's append-only admin log, whether or not anyone opens the app.
  const sweep = async () => {
    try {
      const [{ getRepository }, { runDeadlineSweep }, { defaultDeps }] = await Promise.all([
        import("@/db/createRepository"),
        import("@/agents/deadlineAgent"),
        import("@/services/deps"),
      ]);
      const repo = await getRepository();
      const agencies = await repo.listAgencies();
      for (const agency of agencies) {
        const [requests, tasks, departments] = await Promise.all([
          repo.listRequests(agency.id),
          repo.listAgencyTasks(agency.id),
          repo.listDepartments(agency.id),
        ]);
        const openRequests = requests.filter((r) => r.closedAt == null);
        if (openRequests.length === 0) continue;
        const openByRequest = new Map<string, number>();
        for (const t of tasks) {
          if (t.status !== "done" && t.status !== "cancelled") {
            openByRequest.set(t.requestId, (openByRequest.get(t.requestId) ?? 0) + 1);
          }
        }

        // Tier-2 custodian nudges: open tasks on OVERDUE requests whose
        // department has an email. Under the default policy these park the
        // run at a human checkpoint on /app/agents (§16.3).
        const now = new Date();
        const requestById = new Map(openRequests.map((r) => [r.id, r]));
        const deptById = new Map(departments.map((d) => [d.id, d]));
        const nudgeTargets = tasks
          .filter((t) => t.status !== "done" && t.status !== "cancelled")
          .flatMap((t) => {
            const request = requestById.get(t.requestId);
            const dept = t.departmentId ? deptById.get(t.departmentId) : undefined;
            const email = dept?.defaultResponderEmails?.[0];
            if (!request?.statutoryDueAt || request.statutoryDueAt >= now || !dept || !email) return [];
            return [{ publicId: request.publicId, taskId: t.id, departmentEmail: email, departmentName: dept.name }];
          })
          .slice(0, 3);

        // Persist the run so /app/agents can show, approve, and resume it.
        const runId = crypto.randomUUID();
        await repo.createAgentRun({
          id: runId,
          agencyId: agency.id,
          agentType: "deadline",
          requestId: null,
          status: "planning",
          goal: "Nightly deadline sweep",
          plan: null,
          budgetLimits: null,
          budgetSpend: null,
          startedByUserId: null,
          handoffNote: null,
          lastStepAt: null,
          createdAt: now,
        });
        const persistRun = async (r: import("@/agents/runHarness").AgentRunState) => {
          await repo.updateAgentRun(agency.id, runId, {
            status: r.status,
            plan: r.plan,
            budgetSpend: r.budgetSpend,
            handoffNote: r.handoffNote ?? null,
            lastStepAt: r.lastStepAt ?? null,
          });
        };

        const result = await runDeadlineSweep({
          now,
          agencyId: agency.id,
          runId,
          deps: defaultDeps(repo),
          nudgeTargets,
          persist: persistRun,
          queue: openRequests.map((r) => ({
            publicId: r.publicId,
            dueAt: r.statutoryDueAt ?? new Date(r.createdAt.getTime() + 10 * 86_400_000),
            outstandingTasks: openByRequest.get(r.id) ?? 0,
            complexityScore: r.complexityScore ?? 0,
          })),
        });
        await persistRun(result.run);
        await repo.appendAdminEvent({
          id: crypto.randomUUID(),
          agencyId: agency.id,
          kind: "deadline_sweep",
          actorLabel: "deadline agent",
          summary:
            result.outcome === "awaiting_checkpoint"
              ? `Deadline sweep parked: custodian nudge(s) await approval on /app/agents`
              : (result.digest.split("\n")[0] ?? "Deadline sweep completed"),
          payload: { digest: result.digest, outcome: result.outcome, runId },
          createdAt: new Date(),
        });
      }
    } catch (err) {
      console.error("[jobs] deadline sweep failed", err);
    }

    // Retention warnings (src/domain/retention.ts): flag documents near or
    // past scheduled destruction in each agency's admin log — the proactive
    // agency-wide net; the request page covers only its own review set.
    try {
      const [{ getRepository }, { runRetentionSweep }] = await Promise.all([
        import("@/db/createRepository"),
        import("./retentionSweep"),
      ]);
      const repo = await getRepository();
      for (const agency of await repo.listAgencies()) {
        await runRetentionSweep(repo, agency.id, new Date());
      }
    } catch (err) {
      console.error("[jobs] retention sweep failed", err);
    }

    // Proactive-disclosure librarian (agentic-horizon B1, Phase 5 — gate
    // released 2026-08-13): mine resolved demand for publication candidates.
    // Proposals only — the classification flip stays a named human's act
    // (invariant 9); the sweep is quiet unless a pattern is found.
    try {
      const [{ getRepository }, { runDisclosureSweep }] = await Promise.all([
        import("@/db/createRepository"),
        import("@/agents/disclosureLibrarianAgent"),
      ]);
      const repo = await getRepository();
      for (const agency of await repo.listAgencies()) {
        const [requests, deflections] = await Promise.all([
          repo.listRequests(agency.id),
          repo.listDeflections(agency.id),
        ]);
        const signals = [
          ...requests.map((r) => ({
            kind: "request" as const,
            text: r.interpretedScope ?? r.rawText,
            at: r.receivedAt ?? r.createdAt,
            ref: r.publicId,
          })),
          ...deflections
            .filter((d) => (d.query ?? "").trim().length >= 3)
            .map((d) => ({
              kind: d.kind === "archive_miss" ? ("archive_miss" as const) : ("deflection_query" as const),
              text: d.query!,
              at: d.createdAt,
            })),
        ].sort((a, b) => a.at.getTime() - b.at.getTime());
        if (signals.length === 0) continue;
        const result = await runDisclosureSweep({ signals, now: new Date(), agencyId: agency.id });
        if (result.patterns.length === 0) continue;
        await repo.appendAdminEvent({
          id: crypto.randomUUID(),
          agencyId: agency.id,
          kind: "disclosure_sweep",
          actorLabel: "disclosure librarian",
          summary: `${result.patterns.length} proactive-disclosure candidate(s) found`,
          payload: {
            digest: result.digest,
            outcome: result.outcome,
            patterns: result.patterns.map((p) => ({
              topic: p.topic,
              keywords: p.keywords,
              total: p.total,
              requests: p.requests,
              queries: p.queries,
              misses: p.misses,
              refs: p.refs,
              lastAt: p.lastAt.toISOString(),
            })),
          },
          createdAt: new Date(),
        });
      }
    } catch (err) {
      console.error("[jobs] disclosure sweep failed", err);
    }

    // Connected data sources (docs/connected-sources.md): the nightly pull.
    // Paused sources (syncSchedule null) are skipped; each sync is a durable
    // job so a failure lands on the /admin Health surface, not in a log.
    try {
      const { getRepository } = await import("@/db/createRepository");
      const { isConnectedSource } = await import("@/services/connectedSourceService");
      const repo = await getRepository();
      for (const agency of await repo.listAgencies()) {
        const sources = await repo.listSources(agency.id);
        for (const source of sources) {
          if (!isConnectedSource(source) || source.syncSchedule == null) continue;
          queue.enqueue("sync_connected_source", { agencyId: agency.id, sourceId: source.id });
        }
      }
    } catch (err) {
      console.error("[jobs] connected-source sweep failed", err);
    }
  };

  if (!g.__brandeisSweepTimer) {
    g.__brandeisSweepTimer = setInterval(sweep, SWEEP_INTERVAL_MS);
    // Also run shortly after boot so a restarted server has a fresh digest.
    setTimeout(sweep, 15_000);
  }
}
