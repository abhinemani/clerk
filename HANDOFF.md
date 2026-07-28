# Handoff — resume here

Snapshot for picking this up in a fresh session.
Repo: <https://github.com/abhinemani/clerk> · branch `main`.
**240 tests pass, typecheck + production build clean.**

## What this is
Clerk — an AI-native public records (FOIA) platform. Root spec: `~/Desktop/foia.md`
(+ `~/Desktop/agentic.md` for §16). Principle: **AI proposes, staff disposes** —
every AI action is a reviewable draft; nothing legally significant without a named
human. NOTE: fees/payments were removed on purpose — do not re-add.

## Run it
```bash
export PATH="/opt/homebrew/bin:$PATH"   # Node is Homebrew-installed
npm install
npm test                                # 238 tests
npm run seed                            # seed City of Riverton into the embedded DB
npm run dev                             # http://localhost:3000
```
Demo scripts: `npm run duedate` (no key), `npm run triage` (needs ANTHROPIC_API_KEY).

## Built (all tested)
- **Schema** `src/db/schema.ts` (§5, corpus-centric, append-only audit, pgvector, publicId counter).
- **Turnkey DB** `src/db/createRepository.ts` — `getRepository()` factory: `DATABASE_URL`
  → managed Postgres (Neon/Vercel); else embedded **PGlite** (+pgvector) persisting to
  `./.pgdata` locally or `PGLITE_PATH` on a volume. Migrations auto-run.
  `src/db/repository/drizzleRepository.ts` implements the port; validated on PGlite.
- **Statute engine** `src/statute/` — pure `computeDueDate()` (CA/TX/IL/WA/NY).
- **Domain** `src/domain/` — lifecycle, taskWorkflow, deadlineRisk, publicId, templates,
  redaction (true-redaction burn + §4 leak test).
- **Services** `src/services/` — use cases over the Repository port (submitRequest,
  transitions, task loop, notifications/dispatch delivery, activity source-of-truth,
  deflection logging).
- **AI (essentially complete across §6)** `src/ai/` — `runPipeline()` harness + pipelines:
  intake(§6.1), routing(§6.3), correspondence(§6.6), exemption pass(§6.5), classify(§9.3),
  summarize + answer engine + requester agent(§6.7), copilot(§6.8). Retrieval
  `src/ai/search/` (lexical + hybrid keyword+vector, public-scope enforced), dedup
  `src/ai/dedup/`, deterministic PII + profiles + residual check `src/ai/redaction/`.
  Injectable `EmbeddingProvider` (fake now → real later).
- **Agents (§16) — ALL FIVE RUN** `src/agents/*Agent.ts` through the real harness
  (allowlist→tier→budget→append-only events): deadline (nightly digest, model-free,
  shown in `/app`), fulfillment (search→review→route→memo), release-prep (parks at the
  Tier-3 publish checkpoint), ingest-steward (flags PII, publication candidates),
  requester-side (public-scope pinned).
- **Reporting** `src/reporting/` (§11 metrics, CSV, defensibility export, proactive-pub)
  + `/app/reports` UI.
- **Ingestion API** `POST /api/v1/{agency}/records` (idempotent, sensitivity-gated),
  now backed by `getRepository()`.
- **UI** `src/app/` — portal `/` (Find/Track + file-a-request), staff Command center
  `/app`, request detail + coordinator↔department workflow, Redaction Studio
  `/app/requests/[id]/redact`, responder `/task/[token]`.
- **UI ↔ DB wiring (verified end-to-end in the browser)** — filing at `/portal/request`
  calls the `fileRequest` server action (`src/app/portal/actions.ts`) → real
  `submitRequest` → PGlite/Postgres; the request gets a minted public id + CA statutory
  deadline and appears in the staff queue, tracker, and detail page (whose timeline is
  now the real append-only audit log). `src/lib/live.ts` is the view-model seam: it
  reads via `getRepository()` when the agency is seeded and falls back to the
  `src/lib/demo.ts` fixture on a fresh clone (banner says so). First filing bootstraps
  the agency via `src/lib/bootstrap.ts` (shared with `npm run seed`).

## The next step
1. **Persist coordinator actions** — `RequestWorkspace` (accept triage / dispatch task /
   accept records) still mutates client state only. Wire its buttons to server actions
   over `taskService` (`dispatchTask`, `acceptTaskRecords`…), and `/task/[token]` to
   `getTaskByToken` + `startTask`/`submitTaskRecords`/`pushBackTask`. The services and
   tests already exist — it's the same wiring pattern as `src/app/portal/actions.ts`.
2. **Auth.js** for staff roles (coordinator vs responder vs read-only).
3. A real **EmbeddingProvider** so hybrid search/dedup run on the live corpus.

## Deploy (edit → git push → live)
- **Vercel + Neon**: import repo, add Neon (one-click, injects `DATABASE_URL`, pgvector),
  push. Run migrations via first request or a build step.
- **Self-contained**: Railway/Render/Fly, mount a volume, set `PGLITE_PATH=/data/pgdata`.
Same code both ways. See `.env.example`.
