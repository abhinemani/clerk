# Handoff — resume here

Context package for continuing in a fresh session. Read this top to bottom
before doing anything substantial; it replaces re-reading the git history.
Started 2026-07-29, appended to at the end of each build window since — the
dated entries below run newest-first. Everything is verified working as of
its own entry's date unless marked otherwise.

Repo: <https://github.com/abhinemani/clerk> · branch `main` · everything pushed.
**755 tests pass, typecheck clean** (as of the 2026-08-13 phase-4
entry below).

**NEWEST (2026-08-13 late night): RAG'D TRIAGE + ROUTING (ANSWER-FIRST
PHASE 4) + LAPTOP DOC MOBILE CHECKLIST.**
Owner-directed. The last unbuilt piece of docs/answer-first.md is live —
see that doc's phase-4 section for the full design; the short version:
- `requests.embedding` finally has writers: best-effort at submit (a
  provider outage never blocks filing — tripwire test guards the silent
  path) + `embed_requests` boot backfill so legacy-imported history joins
  the precedent corpus.
- `similarRequestsService.findResolvedPrecedents()`: k nearest
  HUMAN-REVIEWED requests (interpretedScope set; closed ranks above open),
  cosine over stored vectors with per-request and whole-call lexical
  degradation, noise floor instead of force-filled k. Staff-only surface.
- Intake triage + routing prompts bumped to 2026-08-13.1: precedents as
  calibration/custodian evidence with explicit contamination guardrails.
  ⚠ EVAL DEBT WIDENED: request_match AND both 2026-08-13.1 prompts now
  await the first keyed `npm run eval`; the golden set gained RAG cases
  including a scope-contamination check (`scopeExcludes` grader support),
  so that one run covers everything.
- Both ai_action events cite the precedent publicIds the model saw.
- docs/laptop-setup.md gained the "⚡ keep coding from your phone"
  checklist up top: Anthropic + Voyage keys into the claude.ai environment
  settings (+ network-policy note), then hand Part B to any phone-started
  session. After that, only Docker (Part C) and email/DNS (Part D)
  genuinely need a laptop.
755 tests (10 new), typecheck clean. Not verifiable live here (triage needs
a key) — the retrieval, writes, degradation, and grader paths are all
unit-tested offline; first keyed session should file a request and eyeball
the precedent citations in the audit trail.

**PREVIOUS (2026-08-13 night): REDACTION STUDIO ROUND 2 + COPILOT PREFILL.**
The tier-1.5 "likely next asks" plus the copilot-prefill gap, all
browser-verified through the real spine (resident files → task upload →
studio):
- **Redo stack**: Shift+Cmd/Ctrl+Z (or Ctrl+Y) replays what undo removed;
  a NEW act clears the redo branch (history forks, the dead branch dies).
  Redo state is captured OUTSIDE the setState updater — strict mode
  double-invokes updaters, which would double-push.
- **Click a bar → its log card**: bars stay pointer-events:none (drags must
  glide over them); onDown hit-tests the grid point against redactions
  instead. Hit = flash the bar + scroll the exemption-log card into view
  (accent ring). Double-click on a bar re-selects, never re-burns.
- **Redact this word everywhere**: `wordMatches()` in domain/redaction.ts —
  word-BOUNDARY matching, not token equality, deliberately: "(Walsh," and
  "Walsh." must burn too or the finalize leak check flags them (the test
  suite encodes this reasoning). Double-click redacts the word and offers
  "appears N more times → Redact all N" (one act, one undo);
  shift+double-click takes them all immediately.
- **Copilot prefill** (`prefillEvents.ts`): propose_task / propose_extension
  cards now hand their text to the panels via window CustomEvents — no
  pipeline/prompt change, so no eval obligation triggered. propose_task
  prefills a NEW manual "Dispatch a task" form in RequestWorkspace (which
  also closes a real gap: dispatch previously existed only via AI routing
  suggestions), with the department best-guessed from the proposal text;
  propose_extension opens the Statutory-deadline panel with the basis in
  the note. The named-human act stays in the receiving panel, untouched.
- **docs/laptop-setup.md rewritten** around the real workflow: cloud
  sessions (phone-started) build; laptop sessions exist to produce
  committed/configured artifacts — Part A (put ANTHROPIC_API_KEY into the
  claude.ai environment settings so CLOUD sessions can run the eval) is
  the highest-value 15 minutes available.
- Gotcha 8 expanded: dev-bundler chunk corruption after long runs throws
  MODULE_NOT_FOUND on real modules and breaks hydration; `rm -rf .next`
  before suspecting code. It silently killed auto-dispatch during this
  window's verification.
745 tests (6 new: wordMatches geometry + leak-check interplay), typecheck
clean. Copilot's buttons fire events verified end-to-end; the buttons
themselves render only with a live API key — untested pixels, known.

**PREVIOUS (2026-08-13 evening): CONNECTED DATA SOURCES PHASE 1 SHIPPED.**
Owner said "do it" on `docs/connected-sources.md`; phase 1 is live and
browser-verified end to end (register → sync → queue → named publish →
flagged answer → download through the file gate). What landed:
- **No migration.** The spec assumed a new table; the existing `sources`
  table already had connector_kind/sync_schedule/last_sync_*/mapping_config
  from §9.1, unexposed at the port. SourceEntity + updateSource grew the
  fields, `deleteSource` is new (documents survive, source detached — DB
  has ON DELETE SET NULL), all conformance-tested on both adapters.
- **Connector adapter** `src/adapters/dataSource.ts`: DataSourceConnector
  (listDatasets/fetchSlice/probe) + file-drop and in-memory
  implementations behind one conformance suite. Slice files are
  `dataset.period.csv` (period = YYYY[-MM[-DD]]); recordDate = period END.
  TENANCY RULE: the drop dir is derived ({CONNECTED_DROP_PATH}/{agencyId}),
  displayed by the UI, never typed — a free-form path field would be a
  cross-tenant/host filesystem hole on shared deployments.
- **connectedSourceService**: register (reviewed mode pinned: trust
  review_queue, born internal), pause/resume (syncSchedule null = paused),
  delete, and syncConnectedSource. THE TRAP THAT SHAPED IT:
  `upsertDocumentByExternalId` overwrites classification AND metadata on
  update — a naive re-sync would silently UNPUBLISH published slices and
  wipe publicationDecision/askedAs. The sync loop diffs by checksum and
  carries the existing classification + MERGED metadata forward; a changed
  published slice keeps serving fresher bytes under the same human
  decision (same shape as a trusted re-push). Invariant tests pin: sync
  can never set public; re-sync can never unpublish; PII slices carry
  sensitivity into the queue; infected slices refuse item-granular.
- **Job + sweep**: `sync_connected_source` durable job; the nightly sweep
  enqueues every enabled connected source. Admin "Sync now" runs inline.
  Both enqueue classify_documents (queue hints) + embed_document_chunks.
- **Admin surface** `/app/admin/sources` (own page — a source is an
  ongoing relationship, not a one-off import), linked from /app/admin.
- **Requester-facing flag**: ArchiveItem carries `connectedSource`
  provenance (from metadata.connectedSource, the one documentMeta schema);
  answer box rows + archive cards show a "⟳ City data · period" tag, the
  record permalink shows the full flag card (spec copy verbatim: automated
  answer, not a records determination), and the staff "Already public?"
  panel notes "synced data (source, last synced …)" so answer-by-link is
  an informed act. Deflection logging unchanged.
- **Seed**: Riverton registers "Riverton open data portal" through the
  real service, syncs 3 monthly street-sweeping slices via the memory
  connector, Dana publishes June+July, August waits Undecided. The
  flagship query "street cleanings for the last 3 months" now demos with
  the window stated and flags rendered.
Still open, honest: no Playwright e2e spec for the loop yet (verified
manually in-browser this window — worth adding to e2e/ next time the
suite runs); phase 2 (HTTP/Socrata + standing-publication rails) unbuilt.
739 tests, typecheck clean.

**PREVIOUS (2026-08-13 latest): SHARE/PRINT GAPS CLOSED + TWO NEW DOCS.**
Owner-directed ("do 2 and 3" off the priorities assessment). Five fixes on
the polish tier, all verified in a real browser (both themes + print
emulation + measured computed styles, per gotcha 11):
- **Favicon exists**: `src/app/icon.svg` — the compact `<BrandMark>` branch
  as a static SVG, square-cropped, theme-aware via its own
  prefers-color-scheme style (a favicon can't read page tokens, so brand
  values are hardcoded there; keep them in sync with globals.css if the
  palette ever moves). `favicon.ico` fallback uses a both-grounds palette
  (gold structure + terracotta fan) since .ico can't switch on theme;
  `apple-icon.png` is the mark on the board's plum app-icon ground.
- **OG image exists**: `src/app/opengraph-image.png` (1200×630, dark lockup
  on the dark paper — ground-pinned by construction, an OG card's ground
  doesn't follow anyone's theme) + alt text. Next's file conventions wire
  the meta tags; verified in the served head.
- **Printing works from a dark OS**: the dark-theme token block and the
  scroll-reveal are now scoped `screen and (...)`, so paper always gets the
  light palette with every section at rest (gotcha 12's "real bug" half is
  fixed — print-emulated computed opacity on .mk-reveal is 1, was 0). A
  print block keeps ground-pinned surfaces' dark grounds via
  print-color-adjust: exact — without it printers strip backgrounds and the
  pinned white-on-dark ink lands on white paper.
- **Tenant accent is now theme-correct** (the checkAccentColor gap): the
  accent used to be inline vars, theme-blind — dark theme uses --primary as
  accent TEXT on near-black, where any white-ink-safe accent fails AA.
  `tenantAccentCss()` (src/domain/branding.ts) emits per-theme values: the
  stored accent in light; in dark, `accentForDarkTheme()` holds hue AND
  saturation and raises only lightness to 4.5:1 on the dark paper — the
  terracotta lever, mechanized (verified live: Bellmar #1e5c2f renders
  #30924b in dark). --primary-deep keeps the stored accent in both themes
  (only ever a ground under white ink, which the save-time guard already
  guarantees). tenantAccentCss re-validates before emitting — it is the one
  place tenant data reaches a <style> tag, and returns null for anything
  checkAccentColor refuses.
- **`docs/connected-sources.md`** — the never-written spec is written:
  v1 rides the existing document pipeline (connector adapter → sync job →
  publication queue → archive → answer box), file-drop connector first,
  flagged automated answers. Owner decision points marked ⚑ inside —
  notably standing-publication mode (auto-publish per dataset), which is
  NOT to be built without an explicit yes.
- **`docs/laptop-setup.md`** — owner's fresh-machine checklist: zero-key
  baseline, every key worth obtaining + what it unlocks + how to verify,
  and the verification-debt list (eval for request_match, MinIO round-trip,
  live ES). Keep it current when env vars land.
Also reconciled the stale tier list below (legacy import, saved filters +
bulk actions, and compliance PDFs had shipped but were still marked open).
712 tests, typecheck clean.

**PREVIOUS (2026-08-13): BRAND ADOPTED + MARKETING SITE REBUILT.** The owner's
board is now the identity — see CLAUDE.md for the rules layer; this entry is
what happened and what bit. Six colors, `#990000` retired (the Design bullet
below is rewritten accordingly), terracotta accent, gold as ornament only.
BOTH THEMES SHIP; the marketing page was briefly dark-locked and is not any
more. The homepage was rebuilt around AUTOMATION OF RESPONSES, not redaction:
the hero panel is real markup (never a screenshot — it can't go stale and
stays sharp), showing a request that triaged, routed, gathered and drafted
itself, with a named human still holding Send.
THE LOGO, after many rounds: the owner's renders are **rasters** (supplied as
`.svg` files that are one base64 `<image>` — zero `<path>`). So there are two
implementations of one mark, and the split is deliberate: the **cropped
raster is the chrome logo** (`<BrandMarkRaster>` / `<BrandLockup>`), and the
hand-authored **`<BrandMark>` SVG** is for large/decorative/token-recolouring
placements. Do not "unify" them onto the SVG — that was the state that read
as rough, and it is what the owner asked to change.
Nav height is keyed on `.nav:has(.brand-lockup)`, not on a page class, so
`/signup` picked up the taller bar for free and the console/portal (bare mark
or agency seal) stayed at 66px. New gotchas 10–12 below are all from this
work; gotcha 11 in particular cost the most time.
**Still open on this surface:** ~~no `@media print`, no favicon, no OG
image, accent-as-text-on-dark unguarded~~ — all four closed in the entry
above (2026-08-13 latest).

**PREVIOUS (2026-08-13): ANSWER-FIRST phase 3 — the learning QUERY LAYER.**
Retrieve-then-rerank in `priorAnswerService.findPriorAnswers()`. (1) SCOPE
first: for a requester, privately-released prior requests never become
candidates, so they are not in the corpus, the prompt, or the model context —
filtering AFTER the model would leave private scopes sitting in a prompt, and
invariant 3 is about what the query layer can REACH. Two gates: release was
public AND the doc is still classified public (honours audited unpublish).
(2) RETRIEVE via a new `SearchIndex` adapter (`src/adapters/searchIndex.ts`):
built-in is now REAL BM25 with ask-alias boosting — the old scoring was "+1
per term appearing anywhere", no weighting/normalisation/saturation, so a
long doc mentioning "contract" 9× beat a short doc ABOUT the contract.
Elasticsearch/OpenSearch is opt-in behind `ELASTICSEARCH_URL` (fetch-only, no
SDK), FALLS BACK to built-in on any error, and can never WIDEN the set — ids
outside the scoped corpus are dropped so a stale cluster index can't become a
disclosure path. NOT yet run against a live cluster. (3) JUDGE with the new
`request_match` GenAI pipeline, written for PRECISION (retrieval already has
recall; a false positive means a resident never files the request they
needed). Floors differ by audience: requester 0.72, staff 0.45; invented
publicIds are discarded. Runs only when the archive comes up empty — the
moment before filing, not per keystroke. Degrades: no ES → BM25; no API key →
retrieval-only marked *unjudged*; model error → no matches, filing proceeds.
**`npm run eval` NOT run for the new prompt — no ANTHROPIC_API_KEY in the
build environment. Run it before relying on request_match.** 706 tests.

**PREVIOUS (2026-08-13): ANSWER-FIRST phases 1–2 — date-aware search + the
ask-alias loop.** Spec: `docs/answer-first.md`.
The flagship query "street cleanings for the last 3 months" is TWO questions
— a subject and a window — and similarity search is blind to recency, so a
vector match ranks a 2019 sweeping log level with last month's. Now:
`src/domain/dateQuery.ts` (pure, `now` is an argument) lifts the window out,
`searchArchiveDetailed` filters on the record's OWN date, and only the
subject reaches the matchers. Undated records are KEPT — missing date means
unknown, not old. The window is always stated in the UI, and an empty result
under a window says "no record for X dated Y — try widening", because an
invisible filter is indistinguishable from a corpus with gaps (we hit this
live: "paving in 2019" read as "doesn't exist" when it exists outside the
window). THE ASK-ALIAS LOOP: every fulfilled request is a named human
asserting "this ask is answered by these records" — released docs now
accumulate `metadata.askedAs[]` (deduped, capped 25), which joins the search
haystack on both the requester and staff sides, so the archive learns the
public's vocabulary instead of only the government's filing language.
Withheld docs get NO alias. Writes are unconditional on classification —
invariant 3 scopes exposure at the query layer, so a private release's
aliases stay unreachable until a human publishes it — and best-effort, since
a learning write must never fail a lawful release. Still NOT built: prior
resolutions in the pre-filing path (needs `requests.embedding`, which exists
and nothing writes), and RAG'd triage prompts. 687 tests, typecheck clean.

**PREVIOUS (2026-08-13): PRODUCT IS NOW BRANDEIS.** The name went Clerk →
Holmes (2026-08-05, eight hard-coded strings only) → **Brandeis**, and this
sweep carries it all the way through code, comments, docs, identifiers, and
the package name. `branding.productName` is the one source of truth for
what users see; everything else follows it. Title case on purpose — if the
wordmark should render ALL CAPS, that's one line in `src/config/branding.ts`
(or a `text-transform` in globals.css), not a re-sweep.

Two deliberate exceptions, both pinned in CLAUDE.md:
- **"clerk" as a job title stays** — City Clerk, Clerk-Recorder, "the
  records clerk", `clerk@yourcity.gov`. A blanket replace turned "City
  Clerk" into "City Holmes" in 16 places during the first sweep; don't
  repeat it.
- **The `clerk-data` Docker volume keeps its name** — Docker resolves
  volumes by name, so renaming mounts a fresh empty one and a deployment
  looks wiped. Worth revisiting while nothing real is deployed: the rename
  is free today and only gets more expensive.

Compose SERVICE is now `brandeis` (safe — data lives in the named volume).
**Demo/platform credentials changed: `admin@brandeis.example` /
`brandeis-admin-dev`** (was admin@clerk.example / clerk-admin-dev), though
`.env` overrides both on the owner's machine. Saved-filters localStorage key
is `brandeis:savedFilters:*`, with a one-time migration off the original
`clerk:` key. Still `clerk` and outside the codebase's reach: the GitHub
repo, the clone directory, `.claude/launch.json`. 667 tests pass, typecheck
clean.

**PREVIOUS (2026-08-06 later): EMAIL INGESTION SHIPPED** — "most responsive
records ARE emails." Request detail gains "Import a mailbox export"
(coordinator-facing, open requests): .mbox / single .eml / ZIP-of-.eml →
preview (count, date range, subjects; same parser as import) → every
message becomes a review-set document (raw RFC 822 bytes preserved as the
record, mimeType message/rfc822, recordType "email", searchable
headers+body rendition as extractedText, deterministic PII stamps) and
every attachment its own linked document (extracted, OCR-queued if
text-less). Fail-closed PER ITEM: infected/oversize items are refused +
reported, the rest import; one named-actor audit event carries all counts
+ refusals. Parser: src/adapters/mailbox.ts (pure — mbox framing, nested
MIME, base64/QP, RFC 2047 headers, HTML→text, >From unescaping).
Service: mailboxImportService (importMailbox / parseMailboxUpload).
Server-action body limit raised 25→100 MB (per-file caps stay 25 MB).
E2E: e2e/mailboxImport.spec.ts. NOTE: playwright now runs workers:1 — the
specs share one server+DB and parallel runs raced (we hit this).
Follow-ups: threading view (messages carry emailFrom/To/Date metadata,
grouping is a UI exercise), PST support (needs a real parser — punt until
demanded; IT can export mbox/eml), dedupe on Message-ID.

**EARLIER (2026-08-06): VISUAL REDACTION SHIPPED** — the functional gap for
scans/photos/PDFs without a text layer (the docs the text studio could only
withhold). `/app/requests/[id]/redact-visual`: staff draw boxes on rendered
pages; finalize BURNS the pixels server-side (decode → black rects →
re-encode; content destroyed, not overlaid) and mints an image-only PDF
under the same `redacted:{docId}` convention, so releaseService ships it
unchanged. Invariant-1 machinery mirrored: `findUnburnedRegions` verifies
the re-encoded bytes are black (the visual findLeaks); per-page byte check;
artifact carries NO extractedText (OCR text never rides into a release).
Pieces: `src/adapters/imageCodec.ts` (jpeg-js dep — pure JS — + hand-rolled
PNG decoder), `src/domain/imagePdf.ts` (binary-safe assembly; its tests are
the adversary round-trip via extractPdfImages), `visualRedactionService`,
`VisualRedactionStudio` + page-image route, text-studio handoff links.
Fixed along the way: extractPdfImages' scanner matched "stream" inside
"endstream" and skipped real streams on tightly-packed PDFs. E2E
(e2e/visualRedaction.spec.ts): portal file → keyword auto-dispatch →
no-login scan upload → box → burn → artifact fetch; also proved the
responder heads-up email live. NOT covered (honest): text-BORN PDFs still
render only via the text studio (no pure-JS rasterizer — visual studio
covers image-backed docs, which is the actual gap); OCR-suggested boxes
(needs word boxes from tesseract TSV — follow-up).

**RESUME HERE for the next session:** everything through referral phase 3,
department-scoped accounts, answer-with-link, the platform-console redesign,
and the go-live onboarding checklist is SHIPPED and verified (inventory
below). The next priorities, in order (owner-reviewed 2026-08-04):
1. ~~Production durability trio~~ **DONE** (2026-08-05): DURABLE JOB QUEUE —
   jobs are rows (migration 0009), enqueue persists BEFORE running, worker
   claims via FOR UPDATE SKIP LOCKED (multi-instance safe), retries with
   backoff, terminal failures stay queryable; boot re-queues orphaned
   "running" rows; works identically on PGlite and Postgres (a durable
   table beats pg-boss here because pg-boss cannot run on the default
   PGlite deploy — pg-boss remains a drop-in behind the same port).
   S3/MINIO BLOB ADAPTER — fetch-only SigV4 (src/adapters/s3BlobStore.ts),
   signing pinned against AWS's published example signature byte-for-byte,
   activates on S3_* env (NOT yet round-tripped against a live MinIO — do
   that before relying on it). RUNBOOK — docs/operations.md (backup/
   restore both deploy shapes, monthly test-restore checklist).
2. ~~Operator health surface~~ **DONE** (2026-08-05): /admin "Health" —
   green line (with queue depth + stuck-worker hint) or red cards listing
   failed jobs (kind, agency, attempts, error) and failed email relays
   (migration 0010 adds relay_status/relay_error to deliveries;
   RelayNotifier records outcomes; outbox rows kept).
1. ~~Records ingestion & publication~~ **DONE** (2026-08-05, `7917a33`,
   verified live end-to-end): CSV/ZIP import at /app/admin/records-import
   (parser has NO classification column — bulk imports can't say public;
   ZIP members scanned fail-closed via the exported `openZipArchive`;
   external_id re-imports update in place; lazy per-agency file_drop
   source), publication queue at /app/records (Undecided/Published/Kept
   internal tabs; per-doc audited publish with prefilled archive metadata,
   keep-internal decision; bulk loops per doc — one admin event each,
   named actor), AI hints via new `classify_documents` job (suggestion in
   metadata.aiClassification; classification column moves ONLY through
   publicationService's new repo method `setDocumentClassification`),
   source trust switching + ingest-key rotation (audited, key shown once).
   Riverton seeds 3 undecided connector docs through the real import
   service. Go-live "Publish or import records" points at the new page.
   Follow-up same day: **audited emergency UNPUBLISH** (Published tab →
   reason required → named admin event `record_unpublished`; doc lands in
   Kept internal, re-publishable) and a **repository CONFORMANCE SUITE**
   (src/db/repositoryConformance.test.ts — identical assertions against
   InMemory AND Drizzle-on-PGlite; on day one it caught Drizzle dropping
   provenance/retentionUntil/legalHoldReason on document reads+inserts,
   now fixed). Add new port methods to the conformance suite, always.
   Hardening sweep (2026-08-05 evening, all 8 recommended fixes): typed
   metadata accessors (src/domain/documentMeta.ts — the ONE schema for
   documents.metadata; read via readDocumentMeta, write via
   patchDocumentMeta, never raw casts) · deterministic PII flags on import
   (scanPii → metadata.sensitivity → red "⚠ Possible PII" chip, zero API
   key; the LLM note is neutral ink now) · staffAction() wrapper
   (src/auth/actionWrapper.ts — new actions use it; convert old ones as
   touched) · migration 0011: publication_decisions (append-only decision
   history; jsonb publicationDecision is its cache) + instance_meta ·
   SESSION BINDING: JWTs carry an `inst` claim, guards reject other
   databases' cookies (rotate the instance_meta row to sign everyone out)
   · queue counts + keyset pagination at the query layer
   (countPublicationStates / listPublicationDocuments, 50/page, "Load
   older records") · classify jobs chunked 20 ids each · PLAYWRIGHT SMOKE
   (`npm run test:e2e`, e2e/spine.spec.ts): login → CSV import → publish →
   public archive against a throwaway seeded PGlite; waits on the
   layout's `html[data-hydrated]` stamp (HydrationSignal) instead of
   sleeps — use that in any future browser automation too.
   Second sweep (same night): responder heads-up email on dispatch
   (task_responder_notice — sign-in pointer ONLY, the token link stays
   with the dept inbox; invariant test pins that) · decision trail
   rendered on Published/Kept rows (history table, cache fallback for
   pre-0011 rows) · zip decompression-bomb ceiling (MAX_ZIP_MEMBER_BYTES
   in textExtract — protects DOCX + records-import ZIPs) · sessionUser()
   applies the instance check (header can't claim a session guards would
   reject) · listPublicationQueues now delegates to the port predicate
   (was a third copy) · upsertReview returns the STORED row on conflict
   (Drizzle fabricated an id; conformance-pinned) · GitHub Actions CI
   (.github/workflows/ci.yml: tsc + vitest + Playwright smoke).
2. ~~Counsel sign-off~~ **DONE** (2026-08-05): per-agency
   `settings.statuteReview` on the (previously unused) portal_settings
   column — no migration. Compliance section on /app/admin shows the
   statute's actual clock params + review status; recording is an audited
   attestation (name + date). Go-live checklist gained the step (9 steps
   now). Riverton seeds reviewed; statute breadth (more states) still open.
3. ~~Public transparency log~~ **DONE** (2026-08-05): opt-in per agency
   (settings.publicRequestLog, admin toggle, audited) → /[slug]/log —
   summary stats (total/open/on-time %/median days) + every request's
   number, subject, dates, outcome. NO-PII invariant is pure + tested
   (src/domain/transparencyLog.ts): requester fields never cross, subject
   is staff-curated interpretedScope ONLY (raw filing text never published;
   pre-triage rows say "Awaiting review"). Footer link when enabled.
   Riverton seeds ON.
4. Small knock-offs: responder email notification on dispatch to their
   department (they have logins now; only the dept inbox gets the token
   link) · ~~copilot prefill of task/extension panels · redaction redo
   stack, click-a-bar-to-jump, "redact this word everywhere"~~ (all four
   DONE 2026-08-13 night, see newest entry).
5. Phase 5 agents stay gated until real-user proof (docs/agentic-horizon.md).

## What this is

Brandeis — a multi-tenant, AI-native public records (FOIA) platform. One
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
- **Data**: `src/db/schema.ts` (Drizzle; migrations 0000–0011, append-only —
  new schema = new file via `npm run db:generate`). `getRepository()` → managed Postgres via `DATABASE_URL`,
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
  NOTE: `checkAccentColor` only guards WHITE INK ON the accent. It does not
  check the accent used AS TEXT on a dark ground, which the dark theme now
  does — a tenant accent that passes here can still be under-contrast there.
- **Self-serve signup** (2026-08-04, the last piece of the
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
  platform-operator scope (/admin/[slug]); staff see "⚡ on Brandeis" and the
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
- **Design**: Public Sans + Source Serif 4, both self-hosted via next/font
  (no external font dependency — that is a deliberate part of "self-contained
  first"). **Serif means document, sans means interface**: display headings
  are sans, and the serif is reserved for surfaces that ARE a record (the
  drafted letter, the defensibility PDFs).
  Palette rules live in CLAUDE.md — the short version is that the 2026-08-13
  board superseded the navy/gold/red civic triad, `#990000` is retired,
  terracotta is the accent (`#9c4a2c` light / `#c46a4a` dark), and gold is
  ornament that is never text on a light ground. The colour lesson survives
  the palette change and generalises: **at the lightness AA forces,
  saturation is the anti-pastel lever.** Never fix contrast by desaturating
  or over-lightening — that is what turned the old red pink, and terracotta
  goes salmon exactly the same way. Hold the hue, move only lightness.
  `--overdue` dark is `#f65a4c` (status colours are functional, not brand).

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
`amara@bellmar.gov` / `bellmar-demo` · platform `admin@brandeis.example` /
`brandeis-admin-dev`.

Seeded demo moments: Wei's request = full closed cycle with real PDF
download; Jordan's = clarification round-trip (reply as Jordan, or via the
email-in webhook); Morgan's incident report sits at the redaction step with
real PII-laden bytes.

**Platform operator login on THIS machine:** `.env` overrides the seeded
default — use the `PLATFORM_ADMIN_EMAIL` / `PLATFORM_ADMIN_PASSWORD` values
in `.env`, not `admin@brandeis.example` (we hit this).

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
5. **Migrations are append-only** (0000–0011 applied).
6. **Browser-automation logins race hydration** — wait ~4–5s after load
   before dispatching forms; clicks before hydration submit a native GET.
7. **The container doesn't auto-update** — rebuild (`docker compose up -d
   --build`) after code changes, or :3200 shows stale UI (we hit this with
   the pink fix).
8. **tsc noise from `.next/types`** after concurrent build+dev corruption:
   `rm -rf .next/types` and let the dev server regenerate. The BIGGER
   version of the same disease (hit 2026-08-13 evening): after a long dev
   run with many recompiles, the dev bundler's chunk state corrupts —
   dynamic imports start throwing `MODULE_NOT_FOUND` for modules that
   plainly exist (`await import("@/services/taskService")` in fileRequest
   died this way, which silently killed auto-dispatch because that path
   deliberately catch-and-logs), and client chunks 404 so pages serve but
   never hydrate. If hydration hangs or a dynamic import "can't find" a
   real module: `rm -rf .next`, restart the dev server, and re-test before
   suspecting your code.
9. **Structured outputs reject `min`/`max` on numbers** — a Zod
   `.min(0).max(1)` puts bounds in the JSON schema and the API 400s the
   call. Because pipeline riders catch-and-log, this fails SILENTLY (the
   live routing pass was dead for days this way; found + fixed in
   `1a69fa1`). Never bound numeric fields in a pipeline schema — clamp on
   read, like intakeTriage's complexity_score and routing/custodian
   confidence now do.
10. **Detailed SVG dies at chrome size.** The mark's viewBox is ~72 units
    tall; rendered at 36px that is a 0.5× scale, so a 1px stroke lands on
    half a pixel and only solid FILLS survive — dashes, hairlines and
    opacity fades all vanish. Symptom: "the logo looks flat/rough, where
    did the detail go". This is why the chrome logo is a raster now. If you
    ever draw for a small size: solid fills, heavier weights, and drop the
    dasharrays below ~26px. Related trap: the SVG had a `compact` branch
    gated at `size < 56` while every real placement was 36–40px, so the
    detailed branch had literally never rendered anywhere.
11. **VERIFY DESIGN IN A BROWSER, NOT IN TESTS.** Every visual bug this
    window was invisible to `npm test` and obvious in one screenshot: the
    sub-pixel mark, a hero beam drawn at 0.1 opacity under its own bloom, a
    navy wordmark on a near-black footer, an empty-state that never
    rendered, and a black plate around the dark logo (43% of that PNG's
    visible pixels were near-opaque black, baked in by the render — keyed
    out with alpha := max(r,g,b), unpremultiplied, at full res before the
    downscale). Screenshot both themes AND 390px; measure boxes with
    `getBoundingClientRect` rather than eyeballing, since a theme swap that
    shifts layout shows up as a number. Chromium is at
    `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` — pass it as
    `executablePath`; `import { chromium } from "@playwright/test"` (bare
    `playwright` is not installed). Uploads over ~0.9MB fail, so capture at
    deviceScaleFactor 1 and slice tall pages.
12. **Full-page screenshots come back BLANK for scroll-revealed sections**
    unless the context sets `reducedMotion: "reduce"`. That is not just a
    screenshot artifact — it means content genuinely starts at opacity 0 and
    only appears on scroll, so anything that doesn't run the observer (print,
    some crawlers) sees an empty page. Real bug, still unfixed; see the
    print/OG gap noted in the newest entry.

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
2. ~~**Legacy import / migration path.**~~ **DONE** (2026-08-04, see
   inventory: `legacyImportService`, admin-only `/app/admin/import`, CSV →
   real requests with historical statuses/dates, one named-importer event
   per row). Still open from the original framing: importing RELEASE
   history (closed requests' released documents) so the archive/answer box
   inherit years of signal — records-import covers documents, legacy import
   covers requests, but nothing yet links imported docs to imported
   requests as releases.
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
5. ~~**Queue ergonomics at volume.**~~ **DONE** (2026-08-04, see inventory:
   QueueFilterBar saved filters + QueueTable bulk assign, each row still
   individually audited).
6. **Compliance exports.** Mostly done (2026-08-04): per-request
   defensibility-report.pdf and annual-report.pdf ship. Still open: a CSV
   companion to the annual report for states whose AG wants a spreadsheet.
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

- ~~Copilot task/extension proposals point at panels but don't prefill
  them.~~ DONE (2026-08-13 night): prefill via window CustomEvents +
  a manual dispatch form. The prefill BUTTONS render only when a live API
  key produces proposals — the events are e2e-verified, the buttons' pixels
  are not; worth one click when a key exists.
- Demo-fixture archive (unseeded `/riverton`) has no downloadable bytes —
  by design; seed for the real thing.
- `npm run eval` has NOT been run for the `request_match` prompt — no
  `ANTHROPIC_API_KEY` in the build environment. Standing CLAUDE.md
  obligation; run it before relying on that pipeline. (Now step one of the
  verification-debt list in `docs/laptop-setup.md`.)
- The Elasticsearch adapter has never been exercised against a live
  cluster; the S3/MinIO adapter has never round-tripped against live MinIO.
  (Both on the laptop-setup verification-debt list.)
- ~~`requests.embedding` unwritten; phase 4 unbuilt~~ — BOTH DONE
  (2026-08-13 late night, see newest entry). Remaining phase-4 wish:
  the intake dedup in `[agency]/actions.ts` still re-embeds the whole
  request corpus per filing via findDuplicates — it should read the same
  stored vectors the precedent path uses. Small perf win, any session.
- Connected data sources: **phase 1 SHIPPED** (see the newest entry).
  Phase 2 = HTTP/Socrata connectors + standing-publication mode with its
  four rails (attestation cited per publish, PII always quarantines,
  schema-drift drops to reviewed, invariant test on revocation) — all
  specced in `docs/connected-sources.md`. A Playwright e2e for the
  register→sync→publish→flagged-answer loop is also still owed.
- The favicon hardcodes brand values inside `src/app/icon.svg` (a favicon
  can't read page tokens) — if the palette ever moves, move it too.
