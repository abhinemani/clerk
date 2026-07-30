# Handoff — resume here

Context package for continuing in a fresh session. Read this top to bottom
before doing anything substantial; it replaces re-reading the git history.

Repo: <https://github.com/abhinemani/clerk> · branch `main` · everything pushed.
**312 tests pass, typecheck + production build clean** (as of commit `1e7daf8`).

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

Three flows added since (all service-layer tested + audited):
- **Correspondence** (`messageService`): staff↔requester threads on the
  request detail + tracker (owner-only — tracking numbers are guessable),
  clarification round-trip (`clarification_needed` → reply → `in_review`),
  §6.6 AI-drafted replies (template fallback), outbox delivery. Seed:
  Jordan's request waits on a clarification — sign in as Jordan and reply.
- **True redaction** (`redactionService` + `textExtract` + `textPdf`):
  extraction at upload; studio runs on real review-set documents with the
  statute catalog as the reason picker; finalize burns spans into a
  REGENERATED artifact (leak-checked, invariant 1), stored under
  `redacted:{docId}`; `releaseRequest` refuses release_redacted without it
  and ships the burned bytes. Seed: Morgan Reyes' incident report sits at
  the redaction step with PII-laden extractable bytes.
- **Formal denial** (`denyRequest` + `domain/denialLetter`): citation-listed
  letter with the statute profile's appeal language verbatim, named
  approver, denied+closedAt, letter threads into correspondence + outbox.
  UI: the review panel swaps to a denial panel when everything is withheld,
  with §6.6 letter drafting (composed-letter fallback without a key).
- **Email, both directions** (`adapters/email` + `inboundEmailService`):
  outbound delivers for real when EMAIL_FROM + POSTMARK_SERVER_TOKEN or
  RESEND_API_KEY are set (RelayNotifier — outbox row first, always);
  inbound via POST /api/v1/email/inbound (Bearer INBOUND_EMAIL_TOKEN,
  404 when unset) with credential Reply-To addresses (task-{token}@ /
  req-{uuid}@ INBOUND_EMAIL_DOMAIN): responder attachments become extracted
  review-set docs + task submit; requester replies land on the thread
  (sender must match; refusals logged; resumes clarification-paused
  requests).
- **AI library wired live**: routing suggestions (§6.3) ride the triage job
  → latest run renders as proposal cards; exemption-pass job (§6.5 step 2)
  stores LLM suggestions in doc metadata for the studio (merged with the
  PII pass); answer box (§6.7) is hybrid keyword+vector (archive embeddings
  in document_chunks chunk 0, backfill job at boot/release/ingest, Voyage
  behind VOYAGE_API_KEY, fake embedder otherwise).

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
1. **Deploy live** — Railway/Fly single container + volume (PGLITE_PATH,
   BLOB_PATH, AUTH_SECRET, platform creds, ANTHROPIC_API_KEY; now also
   EMAIL_FROM + POSTMARK_SERVER_TOKEN, INBOUND_EMAIL_TOKEN/_DOMAIN with the
   provider's inbound webhook pointed at /api/v1/email/inbound). Makes the
   demo shareable; the marketing site's links become real.
2. **The extension flow** — statute profiles already model extension rules
   (max days, permitted reasons, notice required); build the take-an-
   extension action: reason picker, §6.6 notice letter, recomputed deadline
   logged with its basis (invariant 7), extensions column on requests
   already exists. Legally significant → named human (invariant 4).
3. **Denial without documents** — the deny panel only appears when a review
   set exists and is all-withheld; a "no responsive records / categorically
   exempt" denial needs a surface on the request detail. `denyRequest`
   already supports it.
4. **Extraction breadth + upload safety** — textExtract handles text files +
   PDF text layers (incl. Flate); scans need OCR (adapter port + stub, spec
   §6.5) and DOCX needs a zip/XML pass. Un-extractable docs currently can
   only be withheld or released whole (by design). Also: a virus-scan
   adapter port before public deploy — uploads land in the blob store
   unscanned today.
5. **S3/MinIO BlobStore adapter** + pg-boss queue adapter for multi-instance
   deployments (both ports are ready).
6. **Platform polish** — per-agency branding (colors/seal upload — column
   exists on agencies), agency settings page, observed-holidays editor.
7. **Chunk-level document search (§6.4)** — archive entries embed at entry
   level (chunk 0); full responsive-records search over extracted text needs
   per-chunk embedding at ingest + a staff search surface.
