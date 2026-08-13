# Connected data sources — auto-answering from the city's own public data

Status: **phases 1 and 2 SHIPPED 2026-08-13.** Phase 1: file-drop connector,
reviewed mode, flagged answers, admin surface, Riverton seed. Phase 2:
HTTP + Socrata connectors and standing publication with all four rails —
verified in a browser against Chicago's **live** open-data portal
(`data.cityofchicago.org/ygr5-vcbg`, 2,520 real rows in one monthly slice)
plus a file-drop source exercising auto-publish, schema-drift revocation,
and PII quarantine end to end. Phase 3 (structured row store, tabular
answers) stays gated on real usage.

All decision points are resolved — they were marked ⚑ for the owner per
CLAUDE.md (anything that changes what a requester can see gets asked, not
guessed); the owner delegated them the same day ("do what you think is
best"), and each ⚑ below records the decision and its reasoning.

**Build deviation worth knowing:** the spec called for a new
`connected_sources` table (migration 0012). The build needed NO migration —
the existing `sources` table already carried connector_kind, sync_schedule,
last_sync_* and mapping_config columns from the §9.1 schema, unexposed at
the repository port. Connected sources are `sources` rows with
`connectorKind` set; the port and conformance suite gained the fields and
`deleteSource`. One less table, one less migration, same shape.

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
4. ⚑ **Read-only SQL DSN** — *decided (2026-08-13, owner-delegated): stays
   out.* A live database credential is a different risk class (injection,
   accidental reach into non-public tables), and connectors 1–3 cover the
   realistic cases: any system that can't speak HTTP can schedule a CSV
   export into the file drop. Revisit only when a real deployment demands
   it, as its own design pass — not as a config option quietly added here.

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
- ⚑ **Standing-publication mode** — *decided (2026-08-13, owner-delegated):
  ADOPTED, opt-in per dataset, phase 2, with the rails below as
  non-negotiable parts of the feature.* At registration (or later), a named
  admin attests "this dataset is public data; publish future slices
  automatically," and that attestation is the human act — recorded as an
  audited admin event, revocable per dataset in one click.

  Why adopted rather than reviewed-only: the feature's value is answers
  appearing without a clerk in the loop, and a recurring manual click rots
  — clerks stop clicking, slices pile up Undecided, and residents get
  stale answers, which is its own harm. The product already runs on this
  exact shape: a release auto-publishes to the archive under a standing
  rule, because the named human decision happened upstream. Invariant 9's
  target is *automated judgment* (AI may propose public, never set it);
  here nothing judges — a deterministic sync repeats a named human's
  recorded decision for new periods of the same data.

  **As built (2026-08-13), plus one rule the build added:** an attestation
  only makes FUTURE slices be born public. Nothing in the sync path ever
  flips an *existing* internal document to public — that direction is
  precisely what invariant 9 forbids without a named human act, so slices
  that landed before the attestation still need a per-slice publish. The
  attestation UI says so where the click happens.

  The rails, which are what make the above true:
  - Every auto-published slice's event cites the attestation (who, when,
    which dataset) — the audit trail always reaches a named human. Built as
    one `document_published` admin event per record (the same rule bulk
    publish follows) plus a `publicationDecision` on the document itself.
  - Slices failing the deterministic PII scan ALWAYS quarantine to
    Undecided regardless of mode, with the standing attestation shown next
    to the quarantine so the clerk sees what almost happened.
  - Schema drift quarantines too: if the dataset's columns change from
    what was attested, the mode drops back to reviewed until a human
    re-attests. An attestation covers the data shape the human looked at,
    not whatever the source starts sending later.
  - An invariant-9 test pins the whole path: nothing in sync code can set
    `classification='public'` except via a live attestation by a named
    admin or a per-slice human publish, and revoking the attestation stops
    publication on the very next sync.

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
(schedule, date field, publication mode + attestation ref), enabled,
last_sync status.
Synced documents are ordinary `documents` rows: provenance points at the
source, `metadata.connectedSource` carries {sourceId, dataset, period,
checksum}. New repository port methods go into the conformance suite,
per the hard convention.

### Admin surface

`/app/admin/sources` — its own page, not a bolt-on to records-import
(*decided:* a source is an ongoing relationship with sync state and
attestations; an import is a one-off act — different furniture): register
a source, probe it, see per-dataset sync
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
- Invariant tests: synced slices are born unclassified; the sync path can
  set `classification='public'` ONLY under a live standing attestation by a
  named admin (every publish event cites it; revocation stops publication
  on the next sync; schema drift drops to reviewed); PII-flagged slices
  always quarantine, in either mode.
- Date behavior: golden tests that a synced June slice with
  `recordDate=2026-06-30` surfaces under "last 3 months" in August and
  drops out in October.
- E2E smoke: file-drop CSV → sync job → publication queue → publish →
  answer box shows the flagged card → download logs a deflection.

## Phases

1. **File-drop connector + reviewed mode + flagged answer card.** Zero
   services, every invariant untouched, demoable with Riverton's sweeping
   log. This is the build-next slice.
2. ~~**HTTP + Socrata connectors, scheduled sync, standing-publication mode
   (with all four rails), admin surface polish.**~~ **SHIPPED 2026-08-13.**
   Notes worth carrying into phase 3:
   - Connector config lives in `sources.mappingConfig.connector`, validated
     at write time (`validateConnectorConfig`): https-only URLs, Socrata 4×4
     ids, slug-shaped dataset names. Bearer tokens are **env var NAMES**
     (`tokenEnv`), never values — the DB never holds a credential, which is
     what `sources.credentials_ref` always promised.
   - Socrata slices server-side with SoQL (`$where` window + `$limit`/
     `$offset` paging, 100k-row cap that reports `truncated` rather than
     silently cutting); the HTTP connector fetches one file and slices
     client-side by a date column. Both share `rowsToSlices`.
   - Undated rows are dropped from slices, not filed under a guessed month:
     `recordDate` is what the archive's date filter trusts.
   - Attestations live in `sources.mappingConfig.attestations[dataset]` with
     the column shape the human saw; `classifyNewSlice()` is the whole
     publicness decision in one pure function, which is what the invariant
     tests point at.
3. **Structured row store + tabular slice answers**, only if real usage
   shows document-granularity answers falling short.
