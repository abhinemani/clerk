# Handoff — resume here

Context package for continuing in a fresh session. Read this top to bottom
before doing anything substantial; it replaces re-reading the git history.
Written 2026-07-29 at the end of a long build window — everything below was
verified working in that window unless marked otherwise.

Repo: <https://github.com/abhinemani/clerk> · branch `main` · everything pushed.
**332 tests pass, typecheck + production build clean** (as of `22b0d23`).

## What this is

Clerk — a multi-tenant, AI-native public records (FOIA) platform. One
deployment serves many governments; each gets its own portal, staff
workspace, statute profile, and data. Root spec: `~/Desktop/foia.md`
(+ `~/Desktop/agentic.md` for §16); repo docs in `docs/` — **read
`docs/invariants.md` before touching release/redaction/audit code.**

Operating principles (non-negotiable):
- **AI proposes, staff disposes.** Every AI output is a reviewable draft;
  nothing legally significant happens without a NAMED human (invariant 4).
- `request_events` / `admin_events` are append-only (invariant 5).
- Released redacted artifacts contain no recoverable redacted content
  (invariant 1) — enforced by regeneration + leak checks, tested.
- Requester-facing retrieval is hard-scoped to `classification='public'`
  at the query layer (invariant 3).
- Fees/payments were removed on purpose — do not re-add.
- **Self-contained first (owner preference, on the record):** no hosting
  accounts or external services required to run. Externals (AI keys, email
  providers, clamd, Voyage, managed Postgres) are opt-in env vars behind
  adapters that degrade gracefully. Never present a cloud service as the
  default path.

## What works now — the full inventory

The complete request lifecycle, real and audited end to end:
file (portal, anonymous or signed-in; **pre-filing deflection interstitial**
offers matching already-public records first) → AI intake triage + routing
suggestions + duplicate check → coordinator accepts scope → dispatch
(outbox + real email if configured; no-login task link) → responder uploads
via web **or by replying to the email with attachments** (virus-scanned,
text-extracted, checksummed into the blob store) → exemption-pass + auto-
classification suggestions land on each document → per-document review →
**redaction studio on real documents** (PII pass + LLM suggestions; finalize
burns a REGENERATED artifact, leak-checked + residual-PII gated) → release
by a named approver (residual gate here too; redacted releases ship burned
bytes only) → response letter → archive auto-publish with **working download
links** → hybrid answer box deflects the next resident.

Also complete:
- **Correspondence**: staff↔requester threads (request detail + tracker,
  owner-only on the tracker — tracking numbers are guessable), clarification
  round-trip (`clarification_needed` → reply → `in_review`), AI-drafted
  replies, everything through the outbox.
- **Email, both directions**: outbound via Postmark/Resend (fetch-only, no
  SDKs) behind `RelayNotifier` — outbox row FIRST, always; inbound webhook
  `POST /api/v1/email/inbound` (Bearer `INBOUND_EMAIL_TOKEN`; 404 when off)
  with credential Reply-To addresses `task-{token}@` / `req-{uuid}@`
  `INBOUND_EMAIL_DOMAIN`. Requester replies must match the sender on file;
  refusals are logged events.
- **Formal denial** — exemption-cited letters with verbatim appeal language,
  plus the **no-records determination** (cites nothing, closes the request)
  when the review set is empty. AI letter drafting with composed fallback.
- **Statutory extensions** (§7): one per request, permitted-reason
  validation, deadline recomputed by `computeDueDate()` and logged WITH its
  basis (invariant 7), notice letter through the thread + outbox.
- **Virus scanning** (spec §4): builtin EICAR scanner always on (the refusal
  path works with zero services); clamd via `CLAMAV_HOST` over raw TCP.
  Fail-closed: unscannable = refused. Both upload paths.
- **Coordinator copilot** (§6.8): chat on the request detail (needs
  `ANTHROPIC_API_KEY`); drafted messages editable-in-place and sent under
  the staff name with AI provenance; every consult is an audit event.
- **Hybrid answer box** (§6.7): keyword + vector (RRF), archive embeddings
  as chunk 0 of `document_chunks`, backfill job at boot/release/ingest;
  Voyage behind `VOYAGE_API_KEY`, deterministic fake otherwise.
- **Docker deploy, smoke-tested on this machine**: image builds, boots,
  `SEED_DEMO=true` seeds in-process at boot (the ONLY safe way — see
  gotchas), serves pages with real blobs on the `/data` volume.

## Architecture map (where things live)

- **Routing**: `/` marketing · `/admin` platform console (env creds) ·
  `/[agency]` resident portal (request/track/archive/account + auth flows) ·
  `/[agency]/app` staff workspace behind `(secure)` (queue, request detail,
  admin roster, outbox, reports, redact) · `/task/[token]` no-login
  responder · `/[agency]/files/[docId]` the ONE download gate (public doc →
  anyone; public-release artifact → anyone; private-release artifact →
  owning requester; else staff only) · `/api/v1/{agency}/records` ingestion
  · `/api/v1/email/inbound` email-in webhook.
- **Data**: `src/db/schema.ts` (Drizzle; migrations 0000–0004, append-only —
  new schema = new file via `npm run db:generate`; nothing this window
  needed one). `getRepository()` → managed Postgres via `DATABASE_URL`,
  else embedded PGlite at `PGLITE_PATH` / `./.pgdata`. Repository port +
  InMemory (tests) + Drizzle adapters: `src/services/repository.ts`,
  `src/db/repository/drizzleRepository.ts`.
- **Services** (`src/services/`): requestService (submit/transition/triage/
  **extendRequest**), taskService, releaseService (review/release/**deny**),
  **messageService** (threads/clarification), **redactionService**
  (finalize/burn), **inboundEmailService**, accountService,
  deflectionService, notifications (DbNotifier outbox + RelayNotifier email
  + inbound address helpers).
- **Adapters** (`src/adapters/`): blobStore (local FS), **email**
  (Postmark/Resend), **virusScan** (builtin EICAR / clamd), **textExtract**
  (plain text + PDF text layers incl. FlateDecode — pure node). Pure PDF
  rendering for burns: `src/domain/textPdf.ts`.
- **Jobs** (`src/jobs/`): in-process queue (pg-boss-ready port) —
  intake_triage (+routing rides it), exemption_pass (+auto-classification
  rides it), embed_public_documents; nightly deadline sweep; boot seeding.
  Registered in `src/instrumentation.ts`.
- **AI** (`src/ai/`): runPipeline harness (Zod, retries, prompt versions);
  pipelines all LIVE now except requesterAgent multi-turn; `src/agents/`
  holds the §16.1 five agents + tier/budget framework (built, tested,
  NOT wired — Phase 5).
- **Statutes**: `src/statute/` — pure `computeDueDate()` (incl. extension
  validation), profiles for CA/TX/IL/WA/NY (data, not code).
- **Design**: Public Sans + Source Serif 4; navy/gold/maroon civic triad in
  `globals.css`. Dark-mode maroon is `#c9686a` (deepest AA-passing
  crimson-burgundy) and buttons use `--maroon-btn` (true maroon fill, white
  ink, both modes). The owner explicitly rejected pink-drifting accents —
  if you ever lighten maroon for contrast, keep saturation and stay near
  red; never pastel.

## Run it (this machine)

```bash
export PATH="/opt/homebrew/bin:$PATH"   # Node is Homebrew-installed
npm install && npm test && npm run seed && npm run dev   # :3000
```
Demo credentials (seed prints them): Riverton staff `dana@riverton.gov` /
`riverton-demo` · resident `jordan@rivertonledger.com` / `riverton-resident`
· Bellmar staff `amara@bellmar.gov` / `bellmar-demo` · platform
`admin@clerk.example` / `clerk-admin-dev`.

Seeded demo moments: Wei's request = full closed cycle with real PDF
download; Jordan's = clarification round-trip (reply as Jordan, or via the
email-in webhook); Morgan's incident report sits at the redaction step with
real PII-laden bytes.

**Port layout during the build window** (multiple things run in this repo):
`:3000` another session's dev server on `./.pgdata` · `:3100` this window's
isolated dev server (launch.json entry `clerk-dev-isolated`, scratchpad
PGLITE_PATH/BLOB_PATH + inbound-email env) · `:3200` the Docker container.
Check what's still running before assuming ports.

## Deploy it (self-contained)

```bash
cp .env.example .env    # AUTH_SECRET + PLATFORM_ADMIN_EMAIL/_PASSWORD
docker compose up --build              # → :3000 (PORT overridable)
SEED_DEMO=true docker compose up --build   # …with the demo seeded at boot
```
One volume (`clerk-data` → `/data`) holds DB + blobs. Optional env:
`DATABASE_URL`, `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `EMAIL_FROM` +
(`POSTMARK_SERVER_TOKEN` | `RESEND_API_KEY`), `INBOUND_EMAIL_TOKEN` +
`INBOUND_EMAIL_DOMAIN`, `CLAMAV_HOST`. All documented in `.env.example`.

## Gotchas that WILL bite you (hard-won; several new this window)

1. **One process per PGlite data dir.** Never run build/seed/scripts while
   a server holds the same `.pgdata`. In the container this means: seed ONLY
   via `SEED_DEMO=true` at boot (in-process) — never `docker compose exec …
   npm run seed` against a running server (a second writer; we hit this).
2. **globalThis memoization + dev HMR = stale singletons.** The repo/queue/
   blob-store instances are memoized; after adding or changing a REPOSITORY
   METHOD (or any memoized class), the running dev server keeps the OLD
   instance — symptoms look like "my code doesn't work" (we hit this twice:
   extensionHistory not persisting; getReleaseById missing). Restart the
   dev server after adapter-interface changes. CSS/pages hot-reload fine.
3. **Reseeding invalidates staff sessions** (new user ids) — expected.
4. **Remount-key pattern**: interactive panels remount via a server-state
   fingerprint `key` after router.refresh() — keep it for new panels.
5. **Migrations are append-only** (0000–0004 applied).
6. **Browser-automation logins race hydration** — wait ~4–5s after load
   before dispatching forms; clicks before hydration submit a native GET.
7. **The container doesn't auto-update** — rebuild (`docker compose up -d
   --build`) after code changes, or :3200 shows stale UI (we hit this with
   the pink fix).
8. **tsc noise from `.next/types`** after concurrent build+dev corruption:
   `rm -rf .next/types` and let the dev server regenerate.

## Next: the most important things to make this USEFUL (priority order)

Best-thinking assessment of what stands between "complete demo" and "a
records office runs Tuesday on this." Tiered by adoption impact.

**Tier 1 — adoption blockers**
1. **OCR + DOCX extraction.** Most municipal records are scans and Word
   files; today those can only be withheld or released whole — the
   redaction studio (the crown jewel) doesn't apply to the majority of real
   documents. OCR behind an adapter port (self-contained default: a
   tesseract sidecar container or WASM build; degrade honestly to "no
   text"). DOCX is a zip of XML — extractable with node zlib, no new deps.
   This single item roughly doubles real-world coverage.
2. **Legacy import / migration path.** No office starts empty. A CSV/
   spreadsheet importer for open + historical requests (and release
   history), mapped to real statuses/dates, collapses the switching cost
   from NextRequest/GovQA/spreadsheets — and instantly seeds duplicate
   detection and the archive/answer box with years of signal. Run imports
   through the service layer so history is audited as imported.
3. **Milestone notifications + tracker transparency.** Requesters hear
   nothing between filing and outcome unless staff write. Auto-email on
   status milestones (template-only, per-agency policy toggle, through the
   outbox like everything else) + tracker showing "deadline extended on X
   because Y". Kills the "black hole" complaint that defines bad FOIA
   portals.

**Tier 2 — daily-work leverage**
4. **Staff responsive-records search (§6.4).** The daily job is FINDING
   records. Per-chunk embeddings over extracted text at ingest (chunk 1+ —
   chunk 0 is taken by archive entries), staff-scoped hybrid search, and
   "attach to request" from results. Turns the corpus into fulfillment
   leverage instead of storage.
5. **Queue ergonomics at volume.** Real offices run hundreds of open
   requests: saved filters, bulk actions, and per-coordinator assignment
   (`assigned_coordinator_id` exists in schema, unused). Cheap, big daily
   payoff.
6. **Compliance exports.** The §11 reporting module computes the numbers;
   ship the artifacts counsel actually asks for: annual-report packet
   (CSV/PDF) and a per-request defensibility bundle (timeline + letters +
   exemption log + deadline bases). The audit log was built for this.
7. **Statute breadth + counsel sign-off.** 5 starter state profiles exist;
   each real deployment needs its state present and reviewed. Add profiles
   as demand appears, plus a "reviewed by counsel on DATE" field surfaced
   in the workspace so review status is honest.

**Tier 3 — durability & scale**
8. **Department-scoped accounts** — responders as first-class users (the
   token link stays for the no-login path), department-filtered views.
9. **Retention awareness / legal holds** — flag requested records nearing
   scheduled destruction (small new data model; prevents the catastrophic
   failure mode).
10. **S3/MinIO + pg-boss adapters, backup/restore runbook** — both ports
    are ready; only needed past one machine. Plus copilot depth (prefill
    task/extension proposals into their panels).

**Phase 5 (documented, do not build yet)**: `docs/agentic-horizon.md`
Bucket B — eight specified agent concepts (proactive-disclosure librarian
and appeal-defense packet builder first). Bucket A is fully wired.

## Known small gaps (fair game any session)

- Tracker doesn't yet show extension history to the requester (item 3).
- Copilot task/extension proposals point at panels but don't prefill them.
- Demo-fixture archive (unseeded `/riverton`) has no downloadable bytes —
  by design; seed for the real thing.
- The §6.7 requester agent (multi-turn answer→narrow→file) is built and
  tested but not wired into the portal answer box.
- The in-process job queue loses queued jobs on restart (fine for drafts —
  everything user-visible is persisted first).
