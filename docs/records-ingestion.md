# Records ingestion & publication — implementable spec

**The ask (owner, 2026-08-05):** governments need to connect their existing
systems — CSV exports or APIs — pipe records in, and then DECIDE what becomes
public. Build the pipe and the decision surface.

Read `HANDOFF.md` first. This spec is written to be executed cold in a fresh
session.

## What already exists (reuse, don't rebuild)

| Piece | Where | State |
|---|---|---|
| Ingestion API `POST /api/v1/{agency}/records` | `src/app/api/v1/[agency]/records/` | Works; Bearer `ck_` key (hash at rest), created at provisioning |
| `sources` table | schema: `sources` | Has `trust: auto_publish \| review_queue` and `defaultClassification` — **review_queue has no UI** |
| `upsertDocumentByExternalId` | repository | Idempotent on (sourceId, externalSystemId) — re-push updates in place |
| Blob store / virus scan / text extract | `src/adapters/` | All uploads must go through scan (fail-closed) |
| Embedding + exemption jobs | `src/jobs/` (durable queue) | Enqueue after ingest; archive embeddings power deflection |
| Legacy REQUEST import (CSV) | `/app/admin/import` | Imports requests, NOT records — different thing, leave it |
| Archive + answer box + already-public matching | portal + workspace | Everything public becomes instantly useful |

The core insight: **classification IS the publication decision.**
`classification: "public"` → archive, deflection, answer-by-link.
`"internal"` → staff search only. The missing piece is the human surface for
making that call on piped-in records at volume.

## Build

### 1. Records CSV import (admin UI)
`/app/admin/records-import` (separate from the request importer):
- CSV columns: `title, summary, date, record_type, tags, keywords, filename`
  (all optional except title). Parse with the same tolerant approach as
  `src/domain/legacyImport.ts`.
- Optional ZIP upload alongside the CSV: filenames in the CSV match files in
  the ZIP → bytes go through virus scan → blob store → text extraction.
  Metadata-only rows (no file) are fine — the archive already supports them.
- Every imported doc: `provenance: "connector"`, `classification: "internal"`
  (NEVER auto-public from a bulk import), `processingStatus: "ready"`,
  metadata carries the CSV fields. One admin event summarizing the batch.
- Idempotency: a `external_id` CSV column maps to `externalSystemId` so
  re-imports update instead of duplicate (create a `file_drop` source per
  agency lazily, like provisioning creates the API source).

### 2. The publication queue — the decision surface
`/app/records` (staff, coordinator+): every `internal` document that is NOT
attached to any request (attached docs belong to the request review flow —
do not double-review). For each:
- Show title/filename, source, date, extracted-text preview, AI
  classification suggestion when present.
- Actions: **Publish to archive** (→ `classification: "public"` + archive
  metadata form prefilled from CSV fields; enqueue `embed_public_documents`)
  or **Keep internal** (recorded decision so it leaves the queue — add
  `metadata.publicationDecision = {decision, byUserId, at}`).
- Bulk select + bulk publish/keep, but each doc gets its own audited admin
  event with the named actor (invariant 4 — publishing reaches the public).
- Tab/filter: Undecided · Published · Internal.

### 3. AI assist (optional pass, same session if time allows)
Enqueue the existing auto-classification on ingest so each queue row shows a
suggested public/internal with rationale as an Accept-style hint. AI proposes,
staff disposes — the publish button stays the only act.

### 4. Source management UI
On `/app/admin` (or a card on records-import page): list the agency's
sources (API + file drop), show trust + defaultClassification, allow
switching a source between `review_queue` (default for new sources) and
`auto_publish` (for a source the office already vets, e.g. the agenda
system). Rotating the API key: new key shown once, old hash replaced,
audited.

### 5. Go-live checklist
The existing "Publish or import records" step's `href` should point at the
new records-import page.

## Invariant cautions
- Bulk import NEVER lands anything as `public` directly; only the named-human
  publish (or an `auto_publish` source the admin explicitly configured) does.
- All bytes through `assertUploadable` (virus scan) — including ZIP members.
- ZIP handling: reuse the pure zip reader in `src/adapters/textExtract.ts`
  (it already parses DOCX zips) rather than adding a dependency.
- Tenant scoping as usual; sources and documents already carry agencyId.

## Definition of done
Types + tests pass (importer parsing, publication-decision service with
named-actor + audit assertions, source trust switching), CSV+ZIP import
demonstrably lands N docs in the queue, publishing one makes it appear in
`/[agency]/archive` with working search/deflection, keeping one internal
removes it from the queue but leaves it in staff search. Seed: give Riverton
2–3 undecided connector docs so the queue demos.
