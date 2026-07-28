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
| **§16 agentic framework** — tiers, budgets, allowlists, run orchestrator | ✅ | `src/agents/` |
| **§6 AI pipeline harness** — `runPipeline()` + intake triage (§6.1) | ✅ | `src/ai/` |
| **Domain logic** — lifecycle state machine, public IDs, templates | ✅ | `src/domain/` |
| **Tenant-isolation guard** (§10) | ✅ | `src/db/tenant.ts` |
| **Eval harness** (§13) — golden set + grader + scorecard | ✅ | `evals/` |
| Auth/roles, public portal, staff queue, ingestion API | ⬜ Phase 1 remainder | — |
| Remaining §6 pipelines (dedup, routing, redaction, answer engine) | ⬜ Phase 2–4 | — |

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

## The agentic layer (§16, Phase 5)

Phase 5 turns the single-shot §6 pipelines into agents that work an *open request
over time*. The spec is emphatic that autonomy needs tighter guardrails than
draft-and-approve, so — as with the statute engine — we built and tested the
**safety core first**, ahead of the pipelines it orchestrates. The capability
implementations (corpus search, redaction, email…) are injected via a
`CapabilityRegistry`, so the framework is complete and tested before Phases 2–4
supply them.

`src/agents/`:

- **`actionTiers.ts`** — the guardrail heart. Every side-effecting move is
  Tier 1 (autonomous), Tier 2 (policy-gated, default off), or Tier 3 (always
  human), plus a **forbidden** set (touch the audit log, statute config, or
  reclassify internal→public). The invariant that a government buyer cares about
  — *no configuration can make a Tier-3 action autonomous* — is enforced in code
  and asserted with an adversarial test.
- **`budget.ts`** — per-run tool-call / token / wall-clock caps with a graceful
  "here's where I got to" handoff on exhaustion (§16.2).
- **`definitions.ts`** — the five agents (fulfillment, deadline, release-prep,
  ingest steward, requester-side) as explicit tool allowlists. The requester-side
  agent is hard-pinned to the public corpus.
- **`runHarness.ts`** — the orchestrator. Each step passes, in order:
  allowlist → tier/forbidden → corpus-scope → budget, then executes and appends
  one append-only `agent_action` event with a plan snapshot. Runs are resumable
  (state in `agent_runs`), interruptible, and park at human checkpoints for
  Tier-3 actions — "one approval releases; nothing ships without it."

`agent_runs` (schema §16.2) persists plan state so runs survive restarts; every
step links back to its run in `request_events` so *why did it do that* is always
answerable. The strategic horizon (§16.4) is captured in
[`docs/agentic-horizon.md`](docs/agentic-horizon.md) — documented, not built.

## The AI pipeline harness (§6, Phase 2)

Every §6 AI capability is one pipeline: deterministic prompt build → model call
with **structured output** → Zod validation → reviewable draft. The shared
`runPipeline()` harness ([`src/ai/runPipeline.ts`](src/ai/runPipeline.ts)) owns
the middle — retries with a corrective message on schema-validation failure, and
a run record (model, **pinned prompt version**, token counts) emitted for the
`ai_action` audit log (§6). Pipelines depend only on an injected `ModelClient`,
so they're fully tested against a fake with **no live calls**.

- **Model tier** ([`src/ai/models.ts`](src/ai/models.ts)) — `claude-sonnet-5` for
  all pipelines, per spec §4 (Sonnet-class, one edit to change).
- **Prompts are versioned code** ([`src/ai/prompts/`](src/ai/prompts/)) — each
  pins a `promptVersion` logged with every run; it doesn't change without the
  eval scorecard (§13).
- **First pipeline: intake triage** (§6.1,
  [`src/ai/pipelines/intakeTriage.ts`](src/ai/pipelines/intakeTriage.ts)) —
  interpreted scope, record types, custodians, ambiguity flags, complexity
  score, not-a-request detection, and statutory red flags, as a validated draft.
- **Evals** ([`evals/`](evals/)) — a golden set + grader + scorecard;
  `npm run eval` prints the scorecard (live-scored when `ANTHROPIC_API_KEY` is
  set, grader unit-tested always).

Domain logic the spine needs is in [`src/domain/`](src/domain/): the request
**lifecycle state machine** (legal status transitions only, §5), `PR-YYYY-NNNNN`
**public IDs**, and merge-field **template rendering** (§6.6). Tenant isolation
(§10) is guarded in [`src/db/tenant.ts`](src/db/tenant.ts) — every scoped query
ANDs in the `agency_id` predicate, and a missing/blank id throws.

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
  agents/              §16 agentic framework (Phase 5)
    actionTiers.ts     Tier 1/2/3 + forbidden guardrails
    budget.ts          per-run caps + handoff
    tools.ts           capability surface + registry
    definitions.ts     the five agents (allowlists)
    runHarness.ts      resumable, auditable orchestrator
  ai/                  §6 AI pipeline layer (Phase 2)
    models.ts          model tier (claude-sonnet-5, §4)
    modelClient.ts     ModelClient iface + SDK client + fake
    runPipeline.ts     the shared harness (retry/validate/log)
    prompts/           versioned prompt files (§4)
    pipelines/         intake triage (§6.1) — more to come
  domain/              lifecycle state machine, public IDs, templates
  db/tenant.ts         tenant-isolation guard (§10)
evals/                 §13 golden set + grader + scorecard
docs/agentic-horizon.md  §16.4 strategic-horizon design note
drizzle/               generated migrations
```

Run `npm test` for the full suite (108 tests) and `npm run eval` for the
intake-triage scorecard.

## Next steps (Phase 1 remainder, §12)

Auth.js + staff roles · request lifecycle + event logging on top of the schema ·
public portal (submit/track/message) · staff queue + request detail · document
processing pipeline · **ingestion REST API + file-drop on-ramps** (§9.1) ·
templates + outbound email · `City of Riverton` seed script.

Then Phase 2 introduces the `runPipeline()` AI harness and the intake/routing/
correspondence pipelines (§6).
