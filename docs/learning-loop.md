# The learning loop — resolved requests make the platform smarter

Status: **v1 SHIPPED 2026-08-13** (owner-directed, same session as the
Phase-5 gate release). **v2 SHIPPED 2026-08-14** — embedding-based play
matching, per-play letter scaffolds, and play stats as structured triage
prompt context (see "v2 as built" below). Structural learning from the agency's own case
history — distinct from, and complementary to, the RAG precedents that
already ride the triage/routing prompts (docs/answer-first.md phase 4).

## The idea

A **play** (owner's name, 2026-08-13) is one unit of learned institutional
memory: for one recurring type of ask, the record of how the office
actually resolves it — who has the records, what gets withheld and why,
how long it takes, how it ends. The way a veteran clerk knows "towing
contracts? Public Works, about a week, redact the bank details."

Every closed request is a complete lesson the office already paid for:
what was asked → which department actually had the records → what was
released vs. withheld and under which exemptions → how long it really took.
RAG hands that history to prompts as *text*; the learning loop distills it
into *structure* — histograms, medians, rates — that:

- works with **zero API keys** (deterministic; self-contained first),
- produces **auditable numbers** ("83% of 12 similar requests went to
  Public Works"), not model vibes,
- and feeds the **existing** automation gates, so speed ramps exactly as
  evidence accumulates.

## Architecture (v1)

```
closed requests + tasks + reviews        (the append-only record)
        │  nightly, per agency — 4 agency-wide queries, no N+1
        ▼
distillEpisode → CaseEpisode             (src/domain/caseLearning.ts, pure)
        ▼
buildPlays → term-overlap clusters   (same clustering family as
        │                                 demandPatterns; deterministic)
        ▼
request_plays table                  (migration 0012 — a MATERIALIZED
        │                                 AGGREGATE: replaced wholesale per
        │                                 agency, never mutated, can never
        │                                 drift from the record)
        ▼ at filing time (deterministic, no model)
matchPlay → precedent card event     (pipeline "play_routing")
        + routingSuggestionFrom          → the SAME autoDispatchSuggestions
                                           gate rules and AI use
```

**Confidence is earned, capped, and legible**: `route share × min(1,
episodes/5)`, hard-capped at **0.9**. Explicit agency routing rules own
1.0; the AI pipeline reports its own model confidence; learned routes sit
in between and say exactly where their number came from. The default
posture is unchanged — auto-dispatch stays opt-in per agency
(workflowSettings), and with it off the play is purely advisory.

**Ordering contract at intake**: routing rules run first (explicit policy
outranks learned history); the play pass runs second, and
autoDispatchSuggestions' tasks-already-exist guard makes it advisory
whenever a rule already dispatched.

## Where the knowledge surfaces

- **Request detail** — "Similar past requests" card: episode count, top
  route, median days to close, extension rate, exemptions cited before,
  precedent publicIds. Consulted live, so nightly rebuilds keep old
  requests' cards fresh too.
- **Filing time** — one `play_routing` event (proposal-card shape) on
  the record, plus auto-dispatch when the agency opted in and evidence
  clears its threshold.
- **The stats are prompt-ready**: the same play rows can ride the
  triage/copilot prompts as structured context (v2, below).

## The database decision (owner asked)

A new table in the **same embedded Postgres** (PGlite by default, managed
PG via DATABASE_URL) — deliberately not a separate analytics store:

1. Self-contained first is an owner preference on the record; a second
   database would be the first mandatory extra service in the product.
2. The play store is a *rebuildable aggregate* of the append-only
   audit record. Nightly full rebuild = no incremental-update bugs, no
   drift, trivially correct; drop the table and nothing is lost.
3. Scale: rebuild is 4 agency-wide queries + in-memory clustering. A
   10,000-request agency rebuilds in well under a second. There is no
   scale pressure that justifies new infrastructure — revisit only if an
   agency's closed corpus makes the nightly rebuild measurably slow.

## Invariants kept

- Learned routing **proposes**; dispatch happens through the same gated,
  evented path as manual/rule/AI dispatch (invariant 4 untouched —
  department notice is internal workflow).
- Nothing here reads or writes classification (invariant 9 untouched).
- Episodes are distilled FROM the append-only record; nothing is ever
  written back to it except normal proposal-card events (invariant 5).
- Tenant-scoped end to end; conformance-tested (invariant 2).

## v2 as built (2026-08-14)

- **Embedding-based matching.** Each play row now stores a unit-length
  centroid of its member episodes' stored ask vectors (`request_plays.
  embedding`, migration 0016; computed in `rebuildAgencyPlays`, null when
  no member has a vector). `consultPlays` runs lexical `matchPlay` first —
  self-explaining, keeps v1 behavior — and only on a miss compares the new
  request's STORED ask vector against the centroids
  (`matchPlayByEmbedding`, cosine ≥ 0.6, the duplicate detector's bar).
  Deliberately stored-vectors-only: no live embed call ever happens on
  this path, so it stays deterministic, offline-testable, and free on
  every page render. A meaning-match says so (`matchedBy: "meaning"`) in
  the event payload and on the request-page card.
- **Letter scaffolds per play.** `composePlayScaffold`
  (src/domain/playScaffold.ts, pure) turns a matched play into a
  history-grounded reply draft. It upgrades BOTH branches of
  `draftReplyAction`: keyless, it replaces the generic template; keyed,
  the same stats ride the correspondence pipeline's context bag as
  `similar_request_history` (a context key — not a prompt-file change, so
  no eval gate). Copy rule enforced by tests: history is stated as
  history ("typically closed in about N days — that is our history, not a
  commitment"); the only obligation stated is the statutory due date.
  Drafts only, as ever — staff edits and sends (invariant 4).
- **Play stats as triage prompt context.** `PromptPlayContext` (structural
  slice, like `PromptPrecedent`) renders the matched play's aggregate
  numbers into the intake-triage user turn; prompt version 2026-08-14.1
  with the governance paragraph extended (statistics calibrate, the raw
  text wins). Wired best-effort in `runIntakeTriageJob` next to precedent
  retrieval; the applied-draft event records `playContext` for audit.
  Golden set gained a calibration case and a contamination guard
  (`play-stats-do-not-contaminate`). ⚠ Prompt-rule eval debt until a
  keyed session runs `npm run eval`.

## v2 candidates that remain (build on demand)

- Proposal-feedback learning: accept/dismiss rates on play cards
  tuning the evidence discount.
- Play stats in the copilot prompt (the copilot already sees the
  play_routing event summary; the rich payload could follow).
