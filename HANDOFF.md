# Handoff — resume here

Snapshot for picking this up in a fresh session.
Repo: <https://github.com/abhinemani/clerk> · branch `main`.
**238 tests pass, typecheck + production build clean.**

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
  `/app/requests/[id]/redact`, responder `/task/[token]`. Driven by `src/lib/demo.ts`.

## The next step (the seam is ready)
The DB layer is done and tested, but the **UI pages still read the demo fixture**
(`src/lib/demo.ts`), not `getRepository()`. Wire them so a filed request flows
through to the staff queue/agents:
1. Portal `/portal/request` → a server action calling `submitRequest(defaultDeps(await getRepository()), …)`.
2. Tracker + staff queue + request detail → read via the services (`getRequestActivity`, etc.).
3. Then **Auth.js** for staff roles, and a real **EmbeddingProvider** so hybrid search/dedup run on the live corpus.

## Deploy (edit → git push → live)
- **Vercel + Neon**: import repo, add Neon (one-click, injects `DATABASE_URL`, pgvector),
  push. Run migrations via first request or a build step.
- **Self-contained**: Railway/Render/Fly, mount a volume, set `PGLITE_PATH=/data/pgdata`.
Same code both ways. See `.env.example`.
