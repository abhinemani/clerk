# Handoff — resume here

Context package for continuing in a fresh session. Read this top to bottom
before doing anything substantial; it replaces re-reading the git history.
Written 2026-07-29 at the end of a long build window — everything below was
verified working in that window unless marked otherwise.

Repo: <https://github.com/abhinemani/clerk> · branch `main` · everything pushed.
**358 tests pass, typecheck + production build clean** (as of the OCR/DOCX commit).

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
  (plain text + PDF text layers incl. FlateDecode + **DOCX** via a built-in
  zip reader — pure node; also exports `extractPdfImages` for scan pages),
  **ocr** (OFF by default; `TESSERACT_PATH` local binary over stdin/stdout or
  `OCR_ENDPOINT` HTTP sidecar, `OCR_LANGS`; fail-soft — a doc just stays
  text-less). Pure PDF rendering for burns: `src/domain/textPdf.ts`.
- **Jobs** (`src/jobs/`): in-process queue (pg-boss-ready port) —
  intake_triage (+routing rides it), exemption_pass (+auto-classification
  rides it), embed_public_documents, **ocr_extract** (recovers text from
  scans/images off the request path, logs an ai_action event, re-enqueues
  exemption_pass; no-op with OCR unconfigured); nightly deadline sweep; boot
  seeding. Registered in `src/instrumentation.ts`.
- **AI** (`src/ai/`): runPipeline harness (Zod, retries, prompt versions);
  pipelines all LIVE now except requesterAgent multi-turn; `src/agents/`
  holds the §16.1 five agents + tier/budget framework (built, tested,
  NOT wired — Phase 5).
- **Staff records search** (§6.4, 2026-07-30): `/[agency]/app/search` —
  see roadmap item 4 below for the full shape. repo.listDocuments is the
  one new port method (remember gotcha 2: restart dev servers after adding
  repo methods — we hit it AGAIN this window).
- **Requester agent in the portal** (§6.7, wired 2026-07-30): with
  `ANTHROPIC_API_KEY`, the answer box gains an Ask button — multi-turn
  answer → narrow → file over the public archive (same retrieval as instant
  search, invariant 3), citations validated server-side, draft_request
  prefills the filing form. Degrades to search-only without a key; agent
  errors mid-session fall back silently. Deflections still log ONLY on real
  downloads/scope-downs — never for merely answering.
- **Routing rules** (`src/domain/workflow.ts`, 2026-07-30): deterministic
  keyword→department policy on `agencies.default_routing_rules`, applied at
  filing via `applyAgencyRoutingRules` (taskService) — writes the same
  routing_suggestions event as the AI pass (pipeline `routing_rules`,
  confidence 1.0) and feeds auto-dispatch, so a matching request forwards
  to departments instantly with ZERO AI configured. Admin edits rules in
  the workspace admin page; Riverton seeds with rules for all three
  departments.
- **Workflow automation** (`src/domain/workflow.ts`): opt-in per-agency
  `agencies.workflow_settings` (migration 0005) — auto-assign (least-loaded
  coordinator at intake, deterministic tiebreak) and confidence-gated
  auto-dispatch (routing suggestions ≥ threshold dispatch unattended from the
  triage job via `autoDispatchSuggestions`; guard rails: only fresh requests,
  never when tasks exist). Routing pipeline now emits per-assignment
  `confidence` (prompt v2026-07-30.1). UI: queue assignee chips +
  All/Mine/Unassigned filter, detail-page reassign select, admin "Workflow
  automation" card. Riverton seeds with both ON (+ second coordinator
  casey@riverton.gov / riverton-demo2); everything defaults OFF elsewhere.
- **Redaction studio UX** (2026-08-04): multi-line drag (one gesture →
  one span per covered line, sharing a `groupId` so removing any part
  removes the act; geometry is pure — `spansFromDragRect` in
  `src/domain/redaction.ts`), full keyboard path (arrows move a caret,
  shift+arrows select, Enter burns, Escape cancels — `role="textbox"`,
  focusable, not `role=application`), find-in-document with "redact all
  matches", and an AI triage panel that groups suggestions by exemption
  reason with per-group Accept/Reject, model confidence, an "N of M
  reviewed" counter, jump-to-line, and hover-to-reveal of covered text.
  Every accept is still an explicit human act.
- **Legacy import** (`src/domain/legacyImport.ts` + `legacyImportService`,
  2026-08-04): admin-only `/app/admin/import`, CSV → real requests with
  historical status/dates. Bypasses submitRequest + the transition state
  machine ON PURPOSE (no milestone emails/auto-assign for a bulk history
  load; a row can be born "fulfilled"). One `note` event per row names
  the importer.
- **Compliance PDFs** (2026-08-04): `/app/requests/[id]/
  defensibility-report.pdf` and `/app/reports/annual-report.pdf`, both via
  `renderTextPdf` (no new dep). `buildDefensibilityReport` takes an
  optional `actorNameById` so trails print real names.
- **Queue ergonomics** (2026-08-04): `src/domain/queueFilters.ts` (pure
  assignee/status/risk/department combining), `QueueFilterBar` (saved
  filters = named query strings in localStorage, browser-local by
  design), `QueueTable` (bulk select + bulk assign, each row still going
  through the per-request `assignCoordinator` so every change is
  individually audited). Stats/sweep always cover the WHOLE open queue.
- **Statutes**: `src/statute/` — pure `computeDueDate()` (incl. extension
  validation), profiles for CA/TX/IL/WA/NY (data, not code).
- **Design**: Public Sans + Source Serif 4; navy/gold/red civic triad in
  `globals.css`. **The brand red is `#990000` — owner-specified explicitly
  (2026-07-30); do not drift it.** Light-mode text + button fills use it
  directly (8.9:1). Dark-mode TEXT uses `#ff4d4d` — same hue 0°, full
  saturation, lightened only to the AA floor (#990000 itself is 2.0:1 on
  dark paper); dark buttons keep true `#990000` under white ink. `--overdue`
  dark is `#f65a4c`. Lesson from two rounds of pink complaints: at the
  lightness AA forces, saturation is the anti-pink lever; never fix
  contrast by desaturating or over-lightening.

## Run it (this machine)

```bash
export PATH="/opt/homebrew/bin:$PATH"   # Node is Homebrew-installed
npm install && npm test && npm run seed && npm run dev   # :3000
```
Demo credentials (seed prints them): Riverton staff `dana@riverton.gov` /
`riverton-demo` · coordinator `casey@riverton.gov` / `riverton-demo2` ·
resident `jordan@rivertonledger.com` / `riverton-resident` · Bellmar staff
`amara@bellmar.gov` / `bellmar-demo` · platform `admin@clerk.example` /
`clerk-admin-dev`.

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
`INBOUND_EMAIL_DOMAIN`, `CLAMAV_HOST`, `TESSERACT_PATH` | `OCR_ENDPOINT`
(+ `OCR_LANGS`). All documented in `.env.example`.

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
1. ~~**OCR + DOCX extraction.**~~ **DONE.** DOCX extracts natively (zip
   reader + WordprocessingML flattening, zero deps, detected by content not
   mime). OCR is an adapter (`src/adapters/ocr.ts`): `TESSERACT_PATH` (local
   binary, stdin/stdout) or `OCR_ENDPOINT` (tesseract-server sidecar),
   disabled+honest by default; the `ocr_extract` job feeds whole images and
   the DCTDecode (JPEG) streams of scanned PDFs, 50-page cap, then re-runs
   the exemption pass. Studio copy now distinguishes "OCR running" /
   "no OCR configured" / plain no-text. Not covered: CCITT/JBIG2-encoded
   PDFs (uncommon; degrade honestly) and OCR for requester-reply email
   attachments (correspondence, not review-set).
2. **Legacy import / migration path.** No office starts empty. A CSV/
   spreadsheet importer for open + historical requests (and release
   history), mapped to real statuses/dates, collapses the switching cost
   from NextRequest/GovQA/spreadsheets — and instantly seeds duplicate
   detection and the archive/answer box with years of signal. Run imports
   through the service layer so history is audited as imported.
3. ~~**Milestone notifications + tracker transparency.**~~ **DONE.**
   Template-only requester emails on "received" (tracking number + statutory
   deadline + track link) and "work started" (→ in_progress transition),
   sent via the notifier (outbox-first) with delivery events; per-agency
   toggle `workflowSettings.milestoneEmails` — the ONE opt-OUT default in
   workflow settings (transparency ships on). Outcome letters / extension
   notices keep their own staff-sent flows. Tracker now shows a
   requester-safe "Progress so far" timeline (status changes + extensions
   only — no internal notes, no task traffic) and an extension callout with
   days/date/reason (invariant 7 surfaced to the requester).

**Tier 2 — daily-work leverage**
4. **Staff responsive-records search (§6.4).** SHIPPED (lexical): `/app/
   search` (recordsSearchService) — full-corpus staff-only search over
   filename + extracted text + metadata via LexicalRetriever scope "full";
   burned artifacts hidden; `?req=` context prefills from a request (the
   "Find records" button on the detail page) and enables one-click attach
   (linkRequestDocument + named-actor event + exemption_pass re-enqueue).
   Still open: per-chunk embeddings at ingest (chunk 1+) to make this
   hybrid — the service signature is ready for it.
5. **Queue ergonomics at volume.** Partially done: per-coordinator
   assignment (auto + manual, evented) and Mine/Unassigned filters shipped
   with the workflow-automation work. Still open: saved filters and bulk
   actions.
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

- Copilot task/extension proposals point at panels but don't prefill them.
- Demo-fixture archive (unseeded `/riverton`) has no downloadable bytes —
  by design; seed for the real thing.
- The §6.7 requester agent (multi-turn answer→narrow→file) is built and
  tested but not wired into the portal answer box.
- The in-process job queue loses queued jobs on restart (fine for drafts —
  everything user-visible is persisted first).
