# Handoff — resume here

Snapshot for picking this up in a fresh session.
Repo: <https://github.com/abhinemani/clerk> · branch `main`.
**246 tests pass, typecheck + production build clean.**

## Structure (multi-tenant + auth, since 2026-07-28)
- `/` — marketing site (Clerk the product). `/admin` — platform operator console
  (env creds: PLATFORM_ADMIN_EMAIL/PASSWORD, dev default admin@clerk.example /
  clerk-admin-dev): list/onboard agencies, manage any tenant's accounts.
- `/[agency]` — each government's portal (seal, official banner, its statute
  profile). `/[agency]/login|register|account` resident accounts;
  `/[agency]/app` staff workspace behind Auth.js (v5, credentials + JWT);
  `/[agency]/app/admin` agency-admin roster. Tenant isolation enforced in
  guards AND the repository layer. Registration claims prior email-deduped
  requests. Anonymous filing still works (spec §3).
- Demo credentials print from `npm run seed` (Riverton CA + Bellmar WA).
- DB handle is memoized on globalThis (`src/db/createRepository.ts`) — Next dev
  compiles per-route bundles; module-scope memoization opens multiple PGlite
  handles on one dataDir and writes vanish. Don't "simplify" this back.
- Deploy: turnkey — `npm run build && npm start` with NO env vars runs on
  embedded PGlite (./.pgdata locally, PGLITE_PATH=/data/pgdata on a volume for
  Railway/Fly/Render). Set AUTH_SECRET + platform admin creds in prod.
  DATABASE_URL only needed for Vercel (ephemeral FS) / managed Postgres.

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
