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
the brand now. The accent is terracotta, held at one hue across themes and
moved only in lightness — `#9c4a2c` on light (5.7:1 text, 6.1:1 under white
ink), the board's `#c46a4a` on dark (4.9:1). Do not lighten the dark one:
this hue goes salmon when it loses saturation, the same way the old red went
pink. Gold is **ornament** — marks, rules, eyebrows. It is 1.5:1 on paper, so
it is never text on a light ground.

The mark is the **prism**: a ray refracts into a document — sunlight becoming
understanding. It exists as three assets doing three jobs, and they are not
interchangeable (details in `public/brand/README.md`):

- **Full lockups** — `brandeis-lockup-{dark,light}.png`, the owner's approved
  artwork, one revision per theme, swapped by `<picture>`. Hero sizes only
  (~120px and up); at nav height the letterforms smear.
- **Marks** — `mark-{dark,light}.png`, the prism cropped out of those
  lockups, rendered by `<BrandMarkRaster>` and wrapped with type by
  `<BrandLockup>`. **This is the chrome logo.** Both revisions sit on one
  shared canvas so the header's layout box does not resize when a visitor's
  OS flips theme; regenerate them as a pair or not at all.
- **`<BrandMark>`** — hand-authored SVG of the same prism on brand tokens,
  for placements that run large, recolour from tokens, or need favicon-size
  legibility (it has a `compact` branch that drops detail below 26px). Its
  weak point is the middle: at 30–50px the detailed branch is on but the
  strokes land sub-pixel, which is why chrome uses the raster. It is a
  second *drawing* of the mark, not a second mark — where both would work,
  the approved raster wins.

`<Seal>` is a different thing entirely and is NOT interchangeable with any of
them: it stands in for a **government's own** seal on tenant portals. Never
put the product mark where an agency's seal belongs.

**DARK-LOCKED (owner directive 2026-08-13, supersedes "both themes
ship").** The dark palette is the product's one style on every screen,
regardless of the visitor's OS preference: the dark token block in
`globals.css` is scoped `@media screen` (unconditional on screens), and
`tenantAccentCss` emits the dark-adjusted accent the same way. The light
`:root` palette is NOT dead — it exists for exactly one consumer, PRINT,
which always takes light values so reports and letters don't print as ink
slabs. Do not re-introduce `prefers-color-scheme` gates; do not delete the
light tokens either.

**Pin to the GROUND, not the theme** remains the working principle — with
every screen dark it is mostly moot day-to-day, but the GROUND-PINNED
TOKENS block in `globals.css` stays (it is what keeps the nav/footer/gov
chrome self-consistent in PRINT, where the page ground goes light), and
the lesson stands if theming ever returns. This shipped as a bug
twice: a navy wordmark landing on near-black, then gold ornament going pale
yellow on a dark band. If you add a theme-reactive asset or token, first ask
what the ground under it does.

**The app's surface language (owner-directed, 2026-08-14, all in
globals.css, all print-guarded):** the LIT GROUND (body lighting rig —
vignette, gold dawn, slate key light, plum ember + floor glow, hatch,
grain, vertical falloff; viewport-fixed), the ENGRAVED-PLATE card system
(gold corner bracket on `.card-pad`, letterhead tick on `.panel-title`,
base rule under `.stat-num`, hatch in the slab), and `.civic-hero` header
bands on public pages. These are system-level: new pages inherit them by
using the standard classes — don't re-create per-page texture, and don't
strip the ornaments to "simplify".

Status colors (overdue/due/ok) and the AI teal are **functional, not brand**.
The board does not speak to them and they stay as tuned.

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
   `docs/` holds per-feature specs (records-ingestion, answer-first,
   connected-sources, inter-agency-referral, operations runbook) plus
   `laptop-setup.md` — the owner's checklist for key/env work; cloud
   sessions keep it current when env vars change.

## Current phase
The assistive AI layer is **live**: intake triage and routing (both
RAG'd — precedents from resolved requests ride the prompts, see
docs/answer-first.md phase 4), exemption pass, auto-classification,
redaction suggestions + residual checks, copilot with panel prefill,
correspondence drafting, hybrid answer box, and the portal requester agent.
**Connected data sources** (docs/connected-sources.md) are live through
phase 2: file-drop/HTTP/Socrata connectors, reviewed mode, and per-dataset
standing publication; phase 3 (row store, tabular answers) is gated on real
usage.
**The gates are RELEASED (owner, 2026-08-13): Phase 5 (agentic-horizon
Bucket B) and connected-sources phase 3 are both buildable.** The §16.1
agent framework in `src/agents/` (definitions, action tiers, budgets,
harness) is the substrate — Bucket B agents are configurations over it
(allowlists + budgets), not new architecture. The guardrails are NOT
relaxed: action tiers stay enforced in code (Tier 3 can never be
configured autonomous, the forbidden set stands), every agent action lands
in the append-only log, and invariant 9 still means no agent flips
internal→public — agents propose, a named human publishes.
**Live so far:** B1 (disclosure librarian) and B3 (appeal packets); the
§16.2 checkpoint/steering surface (`/app/agents` — parked runs, per-step
approvals, resume through the harness); and the learning loop v1
(docs/learning-loop.md — "plays"). Next per HANDOFF: B2/B4, then the
fulfillment agent (enum migration → eval golden set → planner behind a
per-agency flag).

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
- Learning loop ("plays", docs/learning-loop.md): `request_plays` is a
  nightly FULL-REBUILD materialized aggregate of the append-only record —
  never mutate play rows incrementally, never add a second consult path.
  Learned-route confidence is capped at 0.9 IN CODE (explicit routing
  rules own 1.0). `archive_miss` deflection rows are demand signal, never
  ROI — every deflection count must exclude them.
- Agent steering (§16.2/§16.3): checkpoint approval is PER-STEP
  (`approvedByUserId` on the plan step), never per-run; forbidden actions
  ignore approvals entirely. Deadline-agent capabilities read only their
  step's `input` + injected deps (no closures over sweep-time state) so
  persisted plans resume across processes — keep that rule for any agent
  whose runs persist.
- Connected-source standing publication: an attestation makes FUTURE slices
  be born public, never flips an existing internal document (that direction
  is invariant 9's). `classifyNewSlice()` in connectedSourceService is the
  ONE publicness decision for synced slices — never add a second path.
  Connector secrets are env-var NAMES (`tokenEnv`); a token value must
  never reach the database. One file-drop source per agency (shared drop
  directory ⇒ duplicates otherwise).

## Definition of done for any feature
Types pass, tests pass (including any invariant tests you touched), migration
included if schema changed, seed data updated if the demo should show it, and
no TODOs that silently skip an invariant.

**And the owner runbook stays true — REQUIRED on every push:** if the change
adds/renames an env var, key, external service, account, or anything else
that ever needs the OWNER's hands, `docs/laptop-setup.md` (and
`.env.example`) must be updated in the same commit, in that file's format —
every step a CLICK path or a PASTE block, never prose instructions to
compose. No owner-facing change → no edit needed, but say so to yourself
explicitly before pushing. If the owner says "laptop doc is stale," fixing
it precedes your next push.

## Sessions & models (owner's workflow)
Work happens in Claude Code cloud sessions started from the owner's phone,
on whichever Claude model the session picks — HANDOFF.md is the context
package that makes any of them work cold. Rules of thumb the owner uses:
long autonomous feature windows and anything touching invariants/release/
redaction go to the strongest available model; well-scoped tasks are fine
on a lighter one. Whatever the model: browser-verify UI work (HANDOFF
gotcha 11), run the full offline suite before every commit, append a
HANDOFF entry per build window, keep `docs/laptop-setup.md` true for any
owner-facing change (see Definition of done — this is a push requirement,
not a courtesy), and push to main (standing permission, granted this
repo's owner-of-one workflow). Report which model actually ran
if asked — never claim to be one you are not.

## When unsure
Prefer asking over guessing on: anything statute-related, anything that changes
what a requester can see, anything touching release/redaction. For everything
else, make the call, note the assumption in the PR/commit description, and keep
moving.
