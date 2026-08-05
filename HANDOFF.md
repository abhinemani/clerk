# Handoff — resume here

Context package for continuing in a fresh session. Read this top to bottom
before doing anything substantial; it replaces re-reading the git history.
Written 2026-07-29 at the end of a long build window — everything below was
verified working in that window unless marked otherwise.

Repo: <https://github.com/abhinemani/clerk> · branch `main` · everything pushed.
**506 tests pass, typecheck clean** (as of `f454a17`, 2026-08-04 late night).

**RESUME HERE for the next session:** everything through referral phase 3,
department-scoped accounts, answer-with-link, the platform-console redesign,
and the go-live onboarding checklist is SHIPPED and verified (inventory
below). The next priorities, in order (owner-reviewed 2026-08-04):
1. **Production durability trio** — pg-boss job adapter (in-process queue
   loses jobs on restart; port ready in src/jobs/queue.ts), S3/MinIO blob
   adapter (port ready in src/adapters/blobStore.ts), and a tested
   backup/restore runbook for the clerk-data volume. The gap between demo
   and pilot is operational now, not functional.
2. **Operator health surface** — outbox delivery failures and job errors
   (triage, exemption pass, OCR) only go to console logs today; put a
   health strip on the /admin dashboard (deliveries table exists; job
   failures need a small persisted record first).
3. **Counsel sign-off + statute breadth** — "reviewed by counsel on DATE"
   per state profile, surfaced in the workspace; add states as pilots need.
4. Small knock-offs: responder email notification on dispatch to their
   department (they have logins now; only the dept inbox gets the token
   link) · copilot prefill of task/extension panels · redaction redo stack,
   click-a-bar-to-jump, "redact this word everywhere".
5. Phase 5 agents stay gated until real-user proof (docs/agentic-horizon.md).

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
  Ease pass (2026-08-04 evening, `230360d`, owner ask "redacting should be
  easy"): **double-click a word** blacks it out (`wordSpanAt` — pure;
  punctuation-joined tokens like emails/SSNs are one word), **"New
  redactions cite" picker** so a batch carries the right citation instead
  of silently taking `exemptions[0]`, **Cmd/Ctrl+Z** undoes the last act
  (act-granular: a multi-line drag or redact-all reverts as one; window
  listener, form fields keep native undo), **Enter in find** = redact all
  matches. Names are the point: the PII scan can't see them, so the manual
  path is now the one-gesture path.
- **Legacy import** (`src/domain/legacyImport.ts` + `legacyImportService`,
  2026-08-04): admin-only `/app/admin/import`, CSV → real requests with
  historical status/dates. Bypasses submitRequest + the transition state
  machine ON PURPOSE (no milestone emails/auto-assign for a bulk history
  load; a row can be born "fulfilled"). One `note` event per row names
  the importer.
- **Signup trust & safety** (2026-08-04 latest): self-signup requires a
  GOVERNMENT email (.gov/.mil/state-local .us — `isGovernmentEmail` in
  src/domain/signupPolicy.ts, lookalike-tested) unless
  `SIGNUP_ALLOW_ANY_EMAIL=true` (self-hosted/demo); fixed-window rate limit
  (3/client/hour, 10 deployment-wide, in-memory). Both env vars documented
  in .env.example. Verified live: gmail signup refused with honest copy.
- **Per-tenant branding** (2026-08-04 latest): `agencies.branding` jsonb
  (column existed since 0000, unused — no migration). Office name, contact
  email, address, hours, ACCENT COLOR (contrast-guarded: white ink must
  clear WCAG AA 4.5:1 — `checkAccentColor` in src/domain/branding.ts, the
  clerk gets "too light" instead of an unreadable portal), and seal upload
  (PNG/JPEG ≤1MB, virus-scanned, blob store, served at /[agency]/seal,
  generic civic seal fallback). Edited in /app/admin "Portal branding";
  accent overrides --primary via a layout wrapper; footer contact block
  renders ONLY provided fields (never an invented address — Riverton seeds
  its details so the demo keeps them). Verified live: gold rejected, forest
  green applied to Bellmar's nav, footer + tab title show Records Division.
  multi-tenant loop): `/signup` — any government creates its own tenant
  (name → auto-slug, state from reviewed statute profiles, admin account),
  through the SAME provisionAgency the platform console uses, so
  self-signed-up tenants are indistinguishable from operator-provisioned
  ones and appear in /admin immediately with their Setup n/8 pill. Ingest
  key shown exactly once, then auto sign-in lands the new admin on their
  go-live checklist. Marketing hero + nav CTA point at it. Kill switch:
  `SELF_SIGNUP=off` (404s the page; action re-checks). "signup" added to
  RESERVED_SLUGS; provisionAgency now has direct tests (reserved/taken/
  malformed slugs, key-hash-at-rest, tenant isolation from row one).
- **Onboarding: go-live checklist + department CRUD** (2026-08-04 late,
  `f454a17`): `computeSetupStatus` (src/domain/setupChecklist.ts, pure +
  tested) derives 8 steps from REAL state — statute + departments required,
  team/routing/directory/archive/email/test-request recommended; nothing is
  a manual tick-box. Card on /app/admin until complete, each step linking
  to its fix; platform tenant cards show "Setup n/8" amber pill. Department
  create/edit finally exists (repo port createDepartment/updateDepartment,
  DepartmentManager on /app/admin; NO delete on purpose — tasks/rules/
  responders reference departments). Email step honestly says
  "outbox-only mode" until EMAIL_FROM + a provider key are set.
- **Platform console redesign** (2026-08-04 evening, owner ask "beautiful
  and effective"): `/admin` is now a deployment dashboard — health stat
  strip (overdue in red), per-tenant cards with On track/overdue pills,
  forwarding-link counts, and Manage/Portal/Workspace actions; `/admin/
  [slug]` gets seal + serif header, a stat strip (incl. on-time closures),
  and sectioned Staff / Tenant links / Residents. Same tokens as the rest
  of the app (stat-row, card, pill, tag) — no new CSS.
- **"Already public?" on request detail** (2026-08-04 evening): open
  requests are matched against the agency's OWN public archive (same
  retrieval as the pre-filing interstitial); top matches render with
  citable permalinks so staff can answer with a link. No cross-tenant
  anything. **Completed by "Answer with this link"** (same night):
  one click (inline confirm) → `fulfillByReference` in releaseService
  sends the letter with the permalink under the staff name, closes the
  request as fulfilled (lifecycle now allows open-state → fulfilled for
  exactly this by-reference path; draft still can't), refuses non-public
  documents (no side door around review), and logs an `answered_by_link`
  deflection (1.0 staff-hours — the ROI number ticks). Anonymous
  requesters: closure still works, letter noted as tracker-only.
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
- **Inter-agency referral** (`src/services/referralService.ts`, 2026-08-04):
  phases 1 AND 2 shipped — `referred` status (NOT a denial; reported
  separately), `agency_directory` table (migration 0007), admin directory
  manager at `/app/admin/directory`, Refer panel on request detail, requester
  letter with their own text pasted back. Phase 2 (2026-08-04, `1a69fa1`):
  `custodian_suggest` pipeline rides the triage job when the agency has
  directory entries; surviving proposals (via `custodianProposals()` — see
  the doc) render as a pre-filling card in ReferPanel. Nothing auto-refers.
  Precision-first evals in `evals/custodianSuggest*` — 8/8 live, 0 false
  referrals. Phase 3 (2026-08-04 evening, owner-directed): **cross-tenant
  forwarding SHIPPED** — `forwardRequest` is THE one sanctioned crossing
  (allow-list: rawText verbatim + requester contact ONLY behind a
  per-forward consent checkbox, default OFF — owner decision on record;
  pinned by an invariant test in referralService.test.ts). Migration 0008
  adds `forwarded_from`/`forwarded_to` jsonb (denormalized snapshots — no
  cross-tenant reads at render, deliberately no FK). Peer links are
  platform-operator scope (/admin/[slug]); staff see "⚡ on Clerk" and the
  button becomes "Refer & forward"; requester tracker deep-links to the
  new request's tracker. Riverton seeds a peer-linked Bellmar entry.
  Verified live: forward created Bellmar's PR-2026-00002, anonymous (no
  consent), zero identity leakage on the rendered page.
- **Retention/legal holds** (`src/domain/retention.ts`, `retentionService`):
  attaching a doc to an open request auto-holds it; closing lifts only holds
  nothing else needs; human litigation holds are never touched by automation.
- **Evals** (`evals/`): intake triage, answer engine, AND exemption pass
  (recall-first, 5 golden municipal docs). `npm run eval` sets
  RUN_LIVE_EVALS=1, which is what loads `.env` — `npm test` stays offline and
  deterministic on purpose. Last live scorecard: exemption 5/5 · recall 100% ·
  precision ~65-73% · 0 missed labels.
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
responder `sam@riverton.gov` / `riverton-demo3` (Public Works only — lands
on /app/tasks, blocked from coordinator surfaces) ·
resident `jordan@rivertonledger.com` / `riverton-resident` · Bellmar staff
`amara@bellmar.gov` / `bellmar-demo` · platform `admin@clerk.example` /
`clerk-admin-dev`.

Seeded demo moments: Wei's request = full closed cycle with real PDF
download; Jordan's = clarification round-trip (reply as Jordan, or via the
email-in webhook); Morgan's incident report sits at the redaction step with
real PII-laden bytes.

**Platform operator login on THIS machine:** `.env` overrides the seeded
default — use the `PLATFORM_ADMIN_EMAIL` / `PLATFORM_ADMIN_PASSWORD` values
in `.env`, not `admin@clerk.example` (we hit this).

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
9. **Structured outputs reject `min`/`max` on numbers** — a Zod
   `.min(0).max(1)` puts bounds in the JSON schema and the API 400s the
   call. Because pipeline riders catch-and-log, this fails SILENTLY (the
   live routing pass was dead for days this way; found + fixed in
   `1a69fa1`). Never bound numeric fields in a pipeline schema — clamp on
   read, like intakeTriage's complexity_score and routing/custodian
   confidence now do.

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

**Tier 1.5 — specced, waiting on a decision or a trigger (future code, ready
to write)**
- ~~Referral phase 3~~ **SHIPPED** (see inventory above) — owner overrode the
  two-real-tenants trigger and decided consent = checkbox default OFF.
- **Redaction studio, likely next asks** (owner cares about this surface;
  cheap now that acts are centralized in `addAct`): a redo stack to pair with
  undo; click an existing bar to jump to its log card (bars have
  `pointer-events: none` today — needs a hit-test in `onDown` instead);
  "redact this word everywhere" (compose `wordSpanAt` + the find-matches
  scan — both pure and already tested).

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
8. ~~**Department-scoped accounts**~~ **DONE** (2026-08-04 late): responder
   role is live — real logins, `user_departments` wired through the repo
   port (`listUserDepartmentIds`/`setUserDepartments`, tenancy-checked),
   `/app/tasks` shows exactly the signed-in responder's departments' tasks
   (fulfillment still happens on the one `/task/[token]` surface; the
   no-login email path is untouched). Guard rule: `requireStaff` with NO
   roles list default-denies responders (→ their task list), so every
   coordinator page — current and future — is safe without edits; pages
   that serve responders opt in via ALL_STAFF_ROLES. Admin roster gets
   per-responder department checkboxes; seed adds sam@riverton.gov /
   riverton-demo3 (Public Works). Coordinators also see /app/tasks as an
   all-departments workload view.
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
