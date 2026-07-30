# Handoff — resume here

Context package for continuing in a fresh session. Read this top to bottom
before doing anything substantial; it replaces re-reading the git history.

Repo: <https://github.com/abhinemani/clerk> · branch `main` · everything pushed.
**260 tests pass, typecheck + production build clean** (as of commit `e429e5f`).

## What this is
Clerk — a multi-tenant, AI-native public records (FOIA) platform. One
deployment serves many governments; each gets its own portal, staff
workspace, statute profile, and data. Root spec: `~/Desktop/foia.md`
(+ `~/Desktop/agentic.md` for §16); repo docs in `docs/`.

Operating principle (non-negotiable): **AI proposes, staff disposes.**
Every AI output is a reviewable draft; nothing legally significant happens
without a named human. Releases REQUIRE a named approver. `requestEvents`
and `admin_events` are append-only. Fees/payments were removed on purpose —
do not re-add.

## Current state — the product loop is COMPLETE and real
A request can travel its entire life with every step persisted and audited:

file (portal, anonymous or signed-in) → AI intake triage (job queue, needs
ANTHROPIC_API_KEY, silent no-op without) → coordinator accepts scope →
dispatch to department (real token + outbox email) → responder uploads REAL
files at no-login `/task/[token]` (blob store, checksummed) → coordinator
accepts → per-document review (release / release_redacted / withhold, with
exemption reasons) → release approved by a NAMED human → response letter to
requester via outbox → `closedAt` stops the clock → public releases
auto-publish to the archive → the answer box deflects the next resident.

The seed (`npm run seed`) runs Wei Chen's request through this entire cycle,
so a fresh clone demos: a closed on-time request, 100% on-time rate, a real
PDF download in the tracker, a letter in the outbox, and a growing archive.

## Architecture map (where things live)
- **Routing**: `/` marketing · `/admin` platform-operator console (env creds)
  · `/[agency]` resident portal (login/register/account/forgot/reset/verify,
  request/track/archive) · `/[agency]/app` staff workspace behind a
  `(secure)` route group (queue, request detail, admin roster, outbox,
  reports, redact) · `/task/[token]` no-login responder · `/[agency]/files/
  [docId]` the ONE download gate (entitlements: public doc → anyone;
  public-release artifact → anyone; private-release artifact → owning
  requester; else agency staff only).
- **Data**: `src/db/schema.ts` (Drizzle, migrations 0000–0004 append-only).
  `getRepository()` (`src/db/createRepository.ts`) → managed Postgres via
  DATABASE_URL, else embedded PGlite persisting to `./.pgdata` / PGLITE_PATH.
  Repository port + InMemory (tests) + Drizzle adapters:
  `src/services/repository.ts`, `src/db/repository/drizzleRepository.ts`.
- **Services** (`src/services/`): requestService (submit/transition/triage
  approve), taskService (dispatch/start/submit-files/pushback/accept/
  reassign), releaseService (review + named-approver release), account
  Service (register/verify/reset/invite/roster/provisionAgency+ingest key),
  deflectionService, notifications (DbNotifier → `deliveries` outbox).
- **Auth** (`src/auth/`): Auth.js v5 credentials + JWT; kinds staff /
  requester / platform; guards re-read role from DB per request; login
  throttle; one-time hashed tokens (verify/reset/invite) in `auth_tokens`.
- **Files**: `src/adapters/blobStore.ts` — BlobStore port + LocalBlobStore
  (BLOB_PATH or `./.blobdata`), sha-256 checksums, traversal-rejecting keys.
- **Jobs/AI**: `src/jobs/` in-process queue (pg-boss-ready interface) +
  `src/instrumentation.ts` boot (registers handlers, nightly deadline sweep
  → admin_events). Intake triage pipeline wired on filing. Voyage embeddings
  behind VOYAGE_API_KEY (`src/ai/search/voyage.ts`), fake fallback.
  Full §6 pipeline library + §16 agents exist in `src/ai/` + `src/agents/`
  (tested; only intake triage is wired into the live path so far).
- **View-model seam**: `src/lib/live.ts` — DB when the agency is seeded,
  `src/lib/demo.ts` fixture only for unseeded `/riverton`.
- **Design**: Public Sans body + Source Serif 4 display via next/font;
  navy/gold/maroon civic triad in `globals.css`; gold-tab nav; audit-trail
  timeline; letterhead motifs; navy marketing hero.

## Run it
```bash
export PATH="/opt/homebrew/bin:$PATH"   # Node is Homebrew-installed
npm install
npm test          # 260 tests
npm run seed      # both demo tenants + full-cycle Wei request + real PDF blob
npm run dev       # http://localhost:3000
```
Demo credentials (also printed by seed):
- Riverton staff admin  `/riverton/app/login`  dana@riverton.gov / riverton-demo
- Riverton resident     `/riverton/login`      jordan@rivertonledger.com / riverton-resident
- Bellmar staff admin   `/bellmar/app/login`   amara@bellmar.gov / bellmar-demo
- Platform operator     `/admin/login`         admin@clerk.example / clerk-admin-dev

Deploy turnkey: `npm run build && npm start` with zero env vars (embedded DB
+ local blobs). Container: mount a volume, set PGLITE_PATH + BLOB_PATH,
AUTH_SECRET (required in prod — server refuses to start without) and
PLATFORM_ADMIN_EMAIL/PASSWORD. DATABASE_URL for managed Postgres/Vercel.
Optional: ANTHROPIC_API_KEY (live triage), VOYAGE_API_KEY (real embeddings).

## Gotchas that WILL bite you (learned the hard way)
1. **One process per `.pgdata`.** PGlite is single-writer. Never run
   `next build`/`npm start`/`npm run seed` while the dev server is up —
   writes vanish or corrupt. Stop the server first; reseed with
   `rm -rf .pgdata .blobdata && npm run seed`; restart.
2. **globalThis memoization is load-bearing** (db handle, job queue, blob
   store, throttle). Next dev compiles per-route bundles with separate
   module scopes — do not "simplify" back to module-level singletons.
3. **Reseeding invalidates staff sessions** (new user ids; requireStaff
   re-reads the DB and bounces old JWTs to login). Expected, not a bug.
4. **Optimistic client state**: RequestWorkspace/ReviewRelease remount via a
   server-state fingerprint `key` after router.refresh() — keep that pattern
   for new interactive panels or stale useState will haunt you.
5. Migrations are append-only (0000–0004 applied). New schema = new file via
   `npm run db:generate`.
6. Browser-automation logins race hydration — wait ~4s after page load
   before dispatching the form, or the click submits a native GET.

## Next steps (priority order, each is one focused session)
1. **Requester correspondence** — the `messages` table has no UI. Build:
   clarification threads on the request detail (staff) + portal tracker
   (resident), outbound through the outbox, inbound via portal form;
   `clarification_needed` status round-trip; §6.6 correspondence pipeline
   can draft staff replies (Accept/Edit/Dismiss card, like triage).
2. **Formal denial flow** — releaseRequest refuses all-withheld sets; build
   the explicit denial path: exemption-cited denial letter (templates table
   exists), status → denied + closedAt, appeal-language from the statute
   profile, audit events.
3. **Deploy live** — Railway/Fly single container + volume (PGLITE_PATH,
   BLOB_PATH, AUTH_SECRET, platform creds, ANTHROPIC_API_KEY). Makes the
   demo shareable; the marketing site's links become real.
4. **Wire more of the existing AI library into the live path** — routing
   suggestions (§6.3) are currently a heuristic on the detail page; the real
   pipeline exists. Same for correspondence drafts, exemption pass in the
   review panel, and hybrid search in the answer box (needs VOYAGE_API_KEY
   + embedding backfill job).
5. **Redaction studio on real documents** — it still renders a fixture;
   point it at the request's uploaded docs (extracted text is the missing
   piece — needs a text-extraction step in the upload job).
6. **S3/MinIO BlobStore adapter** + pg-boss queue adapter for multi-instance
   deployments (both ports are ready).
7. **Platform polish** — per-agency branding (colors/seal upload — column
   exists on agencies), agency settings page, observed-holidays editor.
