# Connected data sources — auto-answering from the city's own public data

Status: **specced 2026-08-13, not built.** Discussed with the owner as the
likely next substantial build; this document turns that conversation into a
buildable shape. Decision points for the owner are marked ⚑ — per CLAUDE.md,
anything that changes what a requester can see gets asked, not guessed.

## The user story

> "When were the street cleanings on my block this year?" Today the best
> case is that a clerk once released a sweeping log and the answer box finds
> it. But the city *has* this data, live, in a system it already publishes
> from — an open-data portal, a GIS layer, a nightly CSV export. A resident
> should get the answer from that data directly, clearly flagged as an
> automated answer from public data, without a clerk touching anything — and
> without anyone having filed a request first.

This is the last step of the answer-first arc (`docs/answer-first.md`):
filing is the fallback, and every layer we add above it deflects more
requests. Prior releases answer what someone already asked; connected
sources answer what nobody has asked yet, because the data was public all
along.

## The load-bearing idea: ride the document pipeline

The tempting design is a new parallel world: dataset tables, row stores, a
query planner. The right v1 is much smaller, because almost everything this
feature needs already exists:

- **Ingestion sources** (`docs/records-ingestion.md`) already model an
  external system pushing records in, with per-source trust and audited key
  rotation.
- **The publication queue** already gives every incoming document a named
  human decision before it becomes public (invariant 9 kept literally).
- **Date-aware search** (`docs/answer-first.md` phase 1) already filters on
  a record's own date, so "last 3 months" works the moment records carry
  `recordDate`.
- **The answer box** already retrieves, cites, and deflects over whatever is
  in the public archive.
- **Deterministic PII scanning** already stamps imported documents.

So v1 of a connected source is: **a puller that turns an external store into
ordinary documents on a schedule**, one document per dataset slice (e.g. one
per month of the sweeping log), each carrying `recordDate`, provenance, and
a text rendition the matchers can chew. Everything downstream — human
publication gate, PII chips, archive, embeddings, date-filtered answers —
is the machinery we already trust. A structured row store with true tabular
answers ("42 cleanings, here is the merged table") is phase 3, judged after
real usage, not before.

## Architecture

### Connector adapter (`src/adapters/dataSource.ts`)

Per the hard convention: an interface, a dev/stub implementation, no SDKs,
fetch-only. A connector answers three questions:

```ts
interface DataSourceConnector {
  /** What datasets does this source offer? (name, description, date field) */
  listDatasets(): Promise<DatasetDescriptor[]>;
  /** Pull one dataset sliced by period; returns rows + the slice's recordDate. */
  fetchSlice(dataset: string, period: Period): Promise<DatasetSlice>;
  /** Cheap health probe for the admin surface. */
  probe(): Promise<{ ok: boolean; detail?: string }>;
}
```

Implementations, in build order:

1. **File drop** (default, zero services — self-contained first): a watched
   directory per agency, CSVs named `dataset.period.csv`. This is the
   degrade path *and* the on-ramp: any IT department can schedule an export.
2. **HTTP CSV/JSON endpoint** (fetch-only, opt-in env/config): a URL +
   optional bearer token, polled on the sync schedule.
3. **Socrata / ArcGIS open-data** (fetch-only, opt-in): the big-city path.
   These portals are already public, which makes the publicness conversation
   easy. Phase 2 — the protocol adds paging/quirks worth isolating.
4. ⚑ **Read-only SQL DSN**: deliberately NOT in this spec's scope. A live
   database credential is a different risk class (injection, accidental
   reach into non-public tables). If demanded, it gets its own design pass.

### Sync job (`sync_connected_source`)

A durable-queue job per (source, dataset): fetch the current slice, render a
text representation (CSV flattened to searchable text, same spirit as the
mailbox parser), compute the content checksum, and upsert through the
records-ingestion service under the source's identity — which means
`external_id` re-imports update in place, imports are audited, and **the
parser still has no classification column**. New slices land in the
publication queue as Undecided, exactly like any other ingested record.
Sync failures surface on the /admin Health page like any failed job.

Everything is logged agent-replayable to request_events/admin_events, so a
Phase 5 librarian agent can later ride the same rails (gated at the action
layer, per `docs/agentic-horizon.md` — nothing here builds Bucket B).

### The publicness gate (the invariant conversation)

Invariant 9: no automated process reclassifies internal → public. Two
honest ways to run a connected source, and the difference is one toggle:

- **Reviewed mode (default):** every synced slice waits in the publication
  queue for a named human publish. Safe, and for monthly slices the burden
  is one click a month per dataset.
- ⚑ **Standing-publication mode (owner decision needed):** at registration,
  a named admin attests "this source is public data; publish future slices
  of THIS dataset automatically," and that attestation is the human act —
  recorded, audited, revocable per dataset. Every auto-published slice's
  event cites it. This reads as compatible with invariant 9's *spirit* (a
  named human made the classification decision; the machine only repeats it
  for new periods of the same data), but it is a genuine widening of the
  letter, it changes what a requester can see with zero per-slice review,
  and a source that starts leaking PII would leak it straight to the
  archive. Mitigation if adopted: rows failing the deterministic PII scan
  are ALWAYS quarantined to Undecided regardless of mode, with the standing
  attestation shown next to the quarantine so the clerk sees what almost
  happened. **Not building this without an explicit owner yes.**

### Answering (requester side)

No new retrieval machinery: published slices are archive documents with
`recordDate`, so the existing answer box + date filter already surfaces
"Street sweeping log — June 2026" for "street cleanings last 3 months".
The additions are presentational and provenance-related:

- Results from connected sources carry a distinct card: source name, dataset,
  sync recency ("synced nightly from data.riverton.gov, last 2026-08-13"),
  and the flag — proposed copy:

  > **Automated answer from the city's public data.** This is informational,
  > not a records determination under the public records law. If it doesn't
  > answer your question, file a request below.

- Deflection logging keeps the existing rule: log only on a real download or
  an explicit "this answers my question," never for merely displaying.

Invariant 3 is untouched by construction: connected-source documents reach
requesters only once `classification='public'`, enforced where it always
was, at the query layer.

### Staff side

On an open request, the existing "Already public?" panel picks up published
slices for free. One addition: when a match is a connected-source slice, the
answer-with-link flow (`fulfillByReference`) shows the provenance card to
the staff member too, so the named human closing the request knows they are
citing synced data and how fresh it is. AI proposes, staff disposes —
nothing about a *filed* request is ever answered automatically.

### Data model

One new table (migration 0012, append-only as ever): `connected_sources` —
agency_id, kind (file_drop | http | socrata), config jsonb (no secrets in
plaintext — same key-hash treatment as ingest keys), per-dataset settings
(schedule, date field, ⚑ publication mode), enabled, last_sync status.
Synced documents are ordinary `documents` rows: provenance points at the
source, `metadata.connectedSource` carries {sourceId, dataset, period,
checksum}. New repository port methods go into the conformance suite,
per the hard convention.

### Admin surface

`/app/admin/sources` (or a section on the existing records-import page —
implementer's choice): register a source, probe it, see per-dataset sync
status and last slice, pause/resume, and delete (which never deletes
already-published documents — unpublishing stays the existing audited
emergency-unpublish path). Registration, config changes, mode changes, and
deletions are all named-actor admin events.

## Non-goals (v1)

- No auto-closing or auto-answering of FILED requests (Phase 5, gated).
- No writes to the connected store, ever; connectors are read-only pulls.
- No cross-tenant sources; a source belongs to one agency like everything.
- No live query passthrough: residents query our archive, never the
  agency's system. (Availability, load, and tenancy all argue for the copy;
  so does invariant 8's checksum discipline.)
- No structured/tabular answer rendering (phase 3, after real usage).

## Test plan

- Connector conformance suite (like the repository one): each connector
  implementation passes identical listDatasets/fetchSlice/probe assertions.
- Invariant tests: synced slices are born unclassified; nothing in the sync
  path can set `classification='public'` (grep-level + runtime, mirroring
  invariant 9's existing test shape); PII-flagged slices always quarantine.
- Date behavior: golden tests that a synced June slice with
  `recordDate=2026-06-30` surfaces under "last 3 months" in August and
  drops out in October.
- E2E smoke: file-drop CSV → sync job → publication queue → publish →
  answer box shows the flagged card → download logs a deflection.

## Phases

1. **File-drop connector + reviewed mode + flagged answer card.** Zero
   services, every invariant untouched, demoable with Riverton's sweeping
   log. This is the build-next slice.
2. **HTTP + Socrata connectors, scheduled sync, admin surface polish.**
3. **Structured row store + tabular slice answers**, only if real usage
   shows document-granularity answers falling short.
