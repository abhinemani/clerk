# CLAUDE.md — Brandeis (AI-native public records platform)

Product name is **Brandeis** (lives in `src/config/branding.ts`). It was
Clerk, briefly Holmes on 2026-08-05, and settled as Brandeis on 2026-08-13
with the naming swept codebase-wide. Title case is deliberate.

## Brand (owner board, 2026-08-13) — this is the identity
Six colors, and every neutral step is an interpolation of them:
`0F141A` ink · `2A313C` slate · `F5C75E` gold · `F7F7F5` paper ·
`C46A4A` terracotta · `4B2A45` plum. Tokens live in `globals.css`.

**The `#990000` civic red is retired.** It was owner-specified on 2026-07-30
and this file used to pin it; the board replaces it and there is no red in
the brand now. The accent is terracotta, held at one hue across modes and
moved only in lightness — `#9c4a2c` on light (5.7:1 text, 6.1:1 under white),
the board's `#c46a4a` on dark (4.9:1). Do not lighten the dark one further:
this hue goes salmon when it loses saturation, the same way the old red went
pink. Gold is **ornament** — marks, rules, and text on dark grounds only; it
is 1.5:1 on paper.

Status colors (overdue/due/ok) and the AI teal are **functional, not brand**.
The board does not speak to them and they stay as tuned.

The mark is the **prism** (`<BrandMark>`): a ray refracts into a document —
sunlight becoming understanding. It is hand-authored SVG on brand tokens, no
binary asset. `<Seal>` is a different thing and is NOT interchangeable: it
stands in for a **government's own** seal on tenant portals. Never put the
product mark where an agency's seal belongs.

Two deliberate exceptions — do NOT "fix" either:
- **"clerk" as a job title stays.** City Clerk, Clerk-Recorder, "the records
  clerk", `clerk@yourcity.gov` — those are government roles, not the product.
- **The `clerk-data` Docker volume keeps its name.** Renaming it silently
  orphans every existing deployment's database and blobs (see the comment in
  `docker-compose.yml`).

The GitHub repo, the clone directory, and `.claude/launch.json` still say
`clerk` — those are outside the codebase's control.

## Sources of truth, in order
1. `docs/invariants.md` — rules that override everything, including user
   convenience and your own judgment about shortcuts. Read it before touching
   release/redaction/audit code.
2. `HANDOFF.md` (repo root) — the rolling status doc: what's shipped, current
   priorities, and hard-won gotchas. Read it before doing anything substantial;
   it replaces re-reading the git history. This file (CLAUDE.md) is the stable
   rules layer and deliberately carries no status.
3. The product spec is `foia.md` at the owner's `~/Desktop` (not in the repo);
   `docs/` holds per-feature specs (records-ingestion, inter-agency-referral,
   operations runbook).

## Current phase
The assistive AI layer is **live**: intake triage, routing, exemption pass,
auto-classification, redaction suggestions + residual checks, copilot,
correspondence drafting, hybrid answer box, and the portal requester agent.
`docs/agentic-horizon.md` is **Phase 5 — autonomous agents. Do not build or
wire Bucket B**; the §16.1 agent framework in `src/agents/` (definitions,
action tiers, budgets, harness) is built and tested but stays dormant until
real-user proof, per the owner. Keep new work compatible: log agent-replayable
events to request_events, and gate externally-visible actions at the action
layer so tiers can bolt on later.

## Stack (do not substitute without asking)
Next.js App Router + TypeScript (strict), Drizzle on **embedded PGlite by
default** (managed Postgres via `DATABASE_URL`), durable job queue as DB rows
(pg-boss-ready port, not pg-boss itself), local-FS blob store (S3/MinIO via
`S3_*` env), Auth.js, Tailwind. Anthropic API for all AI, prompts live in
`/src/ai/prompts/` as versioned files. **Self-contained first (owner
preference, on the record):** every external service is opt-in env behind an
adapter that degrades gracefully; never present a cloud service as the default
path.

## Commands (npm, not pnpm)
- `npm run dev` — run app (no services required; PGlite + FS blobs by default)
- `npm test` — unit + integration, offline + deterministic. Must pass before any commit.
- `npm run test:e2e` — Playwright smoke (workers:1 on purpose — specs share a server+DB)
- `npm run db:generate` / `npm run db:migrate` — Drizzle migrations
- `npm run eval` — AI scorecard (live API; the only thing that loads `.env`)
- `npm run seed` — City of Riverton demo agency

## Hard conventions
- **AI proposes, staff disposes.** Every AI output is a reviewable draft
  rendered as an Accept / Edit / Dismiss card; nothing legally significant
  happens without a named human. AI may propose `classification='public'` but
  never set it (invariant 9).
- Multi-tenancy: every table has agency_id; all data access goes through the
  repository port (`src/services/repository.ts` + InMemory/Drizzle adapters).
  Never write a raw cross-tenant query outside it. New port methods must be
  added to the conformance suite (`src/db/repositoryConformance.test.ts`).
- Migrations are append-only (0000–0011 applied). Never edit an applied
  migration; write a new one.
- External services (email, virus scan, OCR, storage, LLM, embeddings) sit
  behind interfaces in `/src/adapters/` with a dev/stub implementation. No SDK
  calls outside adapters — email providers are fetch-only on purpose.
- `request_events` / `admin_events` are append-only — insert only, no
  update/delete paths, ever.
- Statute logic is data (state profiles in `/src/statute/profiles/`) + pure
  functions. `computeDueDate()` and friends take config as arguments and touch
  no globals or clocks.
- Prompts: changing any file in `/src/ai/prompts/` requires running
  `npm run eval` and reporting the scorecard diff in the commit message.
  Never put min/max bounds on numeric fields in a pipeline schema — the API
  rejects them silently (see HANDOFF gotcha 9); clamp on read.
- Fees/payments were removed on purpose — do not re-add.

## Definition of done for any feature
Types pass, tests pass (including any invariant tests you touched), migration
included if schema changed, seed data updated if the demo should show it, and
no TODOs that silently skip an invariant.

## When unsure
Prefer asking over guessing on: anything statute-related, anything that changes
what a requester can see, anything touching release/redaction. For everything
else, make the call, note the assumption in the PR/commit description, and keep
moving.
