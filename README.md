# Clerk

An AI-native public records (FOIA) request platform. See the root spec (`foia.md`)
for the full product vision; this repo is the Phase 1 foundation.

**AI proposes, staff disposes.** Every AI action produces a reviewable, auditable
draft; nothing legally significant happens without a named human approval.

## Status — Phase 1 (the spine, no AI yet)

This first pass scaffolds the foundation and delivers the two most load-bearing,
most-testable pieces first, per the spec's suggested starting point:

| Area | Status | Where |
| --- | --- | --- |
| Project scaffold (Next.js App Router, TS, Drizzle, Vitest) | ✅ | root config, `src/app` |
| **§5 data model** (22 tables, corpus-centric, append-only audit) | ✅ | `src/db/schema.ts` |
| Initial migration (incl. `pgvector`) | ✅ | `drizzle/0000_*.sql` |
| **§7 statute engine** — `computeDueDate()`, pure & unit-tested | ✅ | `src/statute/` |
| State statute profiles (CA, TX, IL, WA, NY) — data, not code | ✅ | `src/statute/profiles/` |
| Auth/roles, request lifecycle, portal, queue, ingestion API | ⬜ Phase 1 remainder | — |

### The two things worth reading first

- **`src/db/schema.ts`** — the whole product's spine. Key invariants encoded here:
  - Every table carries `agencyId` (multi-tenant from day one, §3).
  - A `Document` belongs to the agency **corpus**, not a request — attached to
    requests via `request_documents` (§5, §9). This is what lets already-public
    records be reused with zero redaction work.
  - `request_events` is **append-only** — the litigation defense (§10).
  - `releases.approved_by_user_id` is `NOT NULL` — no release without a named
    human approver, enforced at the schema level (§10).

- **`src/statute/computeDueDate.ts`** — "the single most testable piece of
  compliance logic in the product" (§7). Pure function: `(receivedAt, clock,
  holidays) → { dueAt, basis, … }`. Respects business-day calendars, observed
  holidays, weekend/holiday rollover, and validated extensions. Returns the
  **basis** for every deadline so it can be logged (§5 RequestEvent).
  27 unit tests in `computeDueDate.test.ts`.

## Getting started

```bash
npm install
npm test          # runs the computeDueDate + calendar suite (27 tests)
npm run typecheck # strict TS across schema + statute engine
```

To run the database migration you need a Postgres with the `pgvector` extension:

```bash
createdb clerk
export DATABASE_URL=postgres://localhost:5432/clerk
npm run db:migrate
```

## Layout

```
src/
  app/                 Next.js App Router (placeholder landing page)
  config/branding.ts   single place to rename "Clerk" (§1)
  db/
    schema.ts          §5 data model — 22 tables
    index.ts           Drizzle client
  statute/             §7 statute engine
    businessDays.ts    UTC-only calendar primitives
    computeDueDate.ts  the pure deadline function
    computeDueDate.test.ts
    profiles/          per-state statute profiles (data)
drizzle/               generated migrations
```

## Next steps (Phase 1 remainder, §12)

Auth.js + staff roles · request lifecycle + event logging on top of the schema ·
public portal (submit/track/message) · staff queue + request detail · document
processing pipeline · **ingestion REST API + file-drop on-ramps** (§9.1) ·
templates + outbound email · `City of Riverton` seed script.

Then Phase 2 introduces the `runPipeline()` AI harness and the intake/routing/
correspondence pipelines (§6).
