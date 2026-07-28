# Handoff — resume here

Snapshot for picking this up in a fresh session. Repo:
<https://github.com/abhinemani/clerk> · branch `main` · HEAD `c43366b`.

## What this is
Clerk — an AI-native public records (FOIA) platform. Root spec: `~/Desktop/foia.md`
(plus `~/Desktop/agentic.md` for §16). Build principle: **AI proposes, staff
disposes**; every AI action is a reviewable draft, nothing legally significant
without a named human.

## State (all committed, 174 tests pass, typecheck clean)
- **Schema** `src/db/schema.ts` (§5, 21 tables, append-only audit, pgvector). Fees
  were **removed on purpose** — do not re-add.
- **Statute engine** `src/statute/` — pure `computeDueDate()` (CA/TX/IL/WA/NY).
- **Agentic framework** `src/agents/` (§16) — action tiers, budgets, run harness,
  and `capabilities.ts` wiring the §6 pipelines into the registry.
- **AI pipelines** `src/ai/` — `runPipeline()` harness + intake(§6.1)/routing(§6.3)/
  correspondence(§6.6); deterministic PII scan `src/ai/redaction/piiScan.ts`.
- **Domain** `src/domain/` — lifecycle, taskWorkflow, deadlineRisk, publicId,
  templates, **redaction (true-redaction burn + §4 leak test)**.
- **Services** `src/services/` — use cases over a **Repository port** with an
  `InMemoryRepository` adapter: submitRequest, transitions, task loop,
  **notifications** (dispatch emails the dept head + logs a `delivery` event),
  **activityService** (append-only log + task rollup = source of truth).
- **Data plane** `src/dataplane/` + `POST /api/v1/{agency}/records` — live,
  idempotent, sensitivity-gated ingestion (key `dev-ingest-key`).
- **UI** `src/app/` — three surfaces on a demo fixture (`src/lib/demo.ts`):
  resident portal `/` (Find/Track), staff **Command center** `/app`, request
  detail with the coordinator↔department workflow, **Redaction Studio**
  `/app/requests/[id]/redact`, responder page `/task/[token]`.

## Run it
```bash
export PATH="/opt/homebrew/bin:$PATH"   # Node is Homebrew-installed
npm install && npm test                 # 174 tests
npm run dev                             # http://localhost:3000
```

## The one next step that unlocks everything
**Wire a Postgres-backed `Repository`** implementing the port in
`src/services/repository.ts`, then point the UI pages at the services (they
currently read `src/lib/demo.ts`). Everything else — services, API, agents,
pipelines, redaction, UI — is already written against that seam. After that:
Auth.js for real users, then the remaining §6 pipelines (dedup §6.2, responsive
search §6.4, answer engine §6.7) which need embeddings/pgvector.
