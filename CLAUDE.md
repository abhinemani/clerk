# CLAUDE.md — Clerk (AI-native public records platform)

## What this project is
Read `docs/spec.md` before doing anything substantial. It is the product spec and the
source of truth. `docs/agentic-roadmap.md` is **Phase 5 — do not build it yet**, but keep
the architecture compatible: log agent-replayable events to RequestEvent, and gate all
externally-visible actions at the action layer (so action tiers can bolt on later).
`docs/invariants.md` lists rules that override everything, including user convenience
and your own judgment about shortcuts.

## Current phase
Phase 1 (the spine — see spec §12). Do not build AI pipelines, connectors beyond the
ingestion API + file drop, or the answer engine until Phase 1's exit test passes.

## Stack (do not substitute without asking)
Next.js App Router + TypeScript (strict), Postgres + pgvector, Drizzle, Auth.js,
pg-boss for jobs, S3-compatible storage (MinIO in dev), Tailwind. Anthropic API for
all AI (Phase 2+), prompts live in /src/ai/prompts/ as versioned files.

## Commands
- `pnpm dev` — run app (assumes `docker compose up -d` for postgres + minio)
- `pnpm test` — unit + integration tests. Must pass before any commit.
- `pnpm db:generate` / `pnpm db:migrate` — Drizzle migrations
- `pnpm eval` — AI pipeline scorecard (Phase 2+)
- `pnpm seed` — City of Riverton demo agency

## Hard conventions
- Multi-tenancy: every table has agency_id; every query goes through the scoped data
  layer in /src/db/scoped.ts. Never write a raw cross-tenant query outside it.
- Migrations are append-only. Never edit an applied migration; write a new one.
- External services (email, payments, virus scan, storage, LLM) sit behind interfaces
  in /src/adapters/ with a dev/stub implementation. No SDK calls outside adapters.
- RequestEvent is append-only — insert only, no update/delete paths, ever.
- Statute logic is data (JSON state profiles in /src/statutes/) + pure functions.
  computeDueDate() and friends take config as arguments and touch no globals or clocks.
- Prompts (Phase 2+): changing any file in /src/ai/prompts/ requires running
  `pnpm eval` and reporting the scorecard diff in the commit message.
- UI follows docs/design.md. Don't invent new components when a listed pattern fits;
  every AI suggestion renders as an Accept / Edit / Dismiss card.

## Definition of done for any feature
Types pass, tests pass (including any invariant tests you touched), migration included
if schema changed, seed data updated if the demo should show it, and no TODOs that
silently skip an invariant.

## When unsure
Prefer asking over guessing on: anything statute-related, anything that changes what a
requester can see, anything touching release/redaction. For everything else, make the
call, note the assumption in the PR/commit description, and keep moving.