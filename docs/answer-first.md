# Answer-first search, and the loop that makes it compound

Status: **partially shipped 2026-08-13.** Phase 1 (date-aware retrieval) and
phase 2 (the ask-alias loop) are in. Phases 3–4 are specified, not built.

## The user story

> You come to your city's public-records page. You ask for street cleanings
> for the last three months. If someone has asked that before, or the data is
> already in the city's records, you get the answer directly. If not, it
> starts a formal request and workflow — and *that* flow is learned from, so
> the next person asking gets answered instead of filed.

Filing is the fallback, not the front door. The product already opens this
way: the portal is a single question box, and the flow underneath it is
labelled Answer → Narrow → File.

## Two retrieval modes, not one

The story hides a fork that is easy to miss, and getting it wrong makes the
flagship example fail in a demo.

**Document retrieval** — *"the Acme paving contract"*. One record, named by
its subject. Keyword + vector similarity handles this well, and it is what
the archive search was built for.

**Data queries** — *"street cleanings for the last three months"*. A filtered
slice of a recurring dataset. This is a different problem: **embeddings encode
meaning, not recency.** A vector search will happily rank a 2019 street
sweeping log above last month's, because the two are semantically identical.
Similarity cannot express "last three months"; only a filter can.

So a query is parsed into a **subject** and a **window**, the window becomes a
real filter, and only the subject reaches the matchers. Leaving "for the last
3 months" in the embedded text also *hurts* the subject match, because those
tokens carry no topical signal.

## What is built

### Phase 1 — date-aware retrieval

`src/domain/dateQuery.ts` (pure, `now` is an argument, no globals or clocks —
same rule as `computeDueDate`).

- `parseDateQuery(query, now)` → `{ range, residual, matchedPhrase }`.
  Handles "last 3 months", "past six weeks", "last 30 days", "since March",
  "in 2024", "this year", "year to date", and the bare singulars.
- `withinRange(recordDate, range)` — **undated records are kept.** A missing
  `recordDate` means *unknown*, not *old*; silently dropping undated records
  would quietly shrink the public's view of the corpus with no way to tell.
- Month arithmetic clamps: one month before 31 March is 28 February, not
  3 March.
- "since November" asked in August 2026 means *last* November. The window
  never reaches into the future.

`searchArchiveDetailed()` filters on `ArchiveItem.recordDate` — the record's
own date (meeting date, report date), falling back to the release date — and
returns the window so the UI can state it. **A filter the user cannot see is
indistinguishable from a corpus with gaps**, so the answer box prints
"Showing *street cleanings* dated May 13 – Aug 13, 2026. Undated records are
included."

### Phase 2 — the ask-alias loop

The heart of it. Every fulfilled request is a named human asserting *"this
plain-language ask is answered by these specific records."* That pair is
produced for free by a workflow the office already runs, and it is the only
thing in the system that teaches the archive the **public's** vocabulary
rather than the government's filing language:

> A resident asks for "the police video from the parade".
> The agency filed it as "Axon Body 3 export, Incident 2025-0714-A".

No amount of corpus growth closes that gap. Accumulated phrasings do.

On release, `releaseRequest()` appends the request's interpreted scope to
`metadata.askedAs[]` on every **released** document (`addAskAlias`,
de-duplicated case-insensitively, capped at 25, oldest dropped first).
Withheld documents get nothing — a record the public never received must not
advertise itself under an ask it did not answer.

Aliases join the search haystack in both directions: the requester-facing
archive search and the staff records search. When a record surfaces *because*
of an alias, the answer box says so — "Someone asked for this before — it was
released in response to an earlier request."

**Why the write is unconditional.** Aliases are written for released
documents whether or not they are public. Exposure is not this field's job:
requester-facing retrieval is hard-scoped to `classification='public'` at the
query layer (invariant 3), so a private release's aliases are unreachable
until a named human publishes the record — and then its history comes with
it. Enforcing disclosure at the write site would duplicate the invariant in a
second place and create a way for the two to disagree.

**Why it is best-effort.** The alias write is wrapped and logged. A learning
write must never be the reason a lawful release fails.

## What is specified and NOT built

### Phase 3 — resolved requests in the pre-filing path

Today `findDuplicates` runs *after* filing, compares **lexically** (Jaccard,
though it accepts an embedding provider), and writes a staff-facing
`ai_action` event. It flags "possible duplicate of PR-104" but never retrieves
what PR-104 was answered *with*, and the requester never sees it.

Two changes:

1. **Persist `requests.embedding`.** The column exists on the schema and
   nothing writes it. Populate it at intake so similarity is semantic and
   accumulates, rather than being recomputed lexically against a live scan.
2. **Answer from prior resolutions before filing.** When a new ask is near a
   *resolved* request whose documents are public, offer those documents
   directly. Phase 2 already makes this partly emergent — the prior request's
   words are in the index — but an explicit path can say "PR-104 asked this
   in March; here is what was released", including when the phrasing has
   drifted too far for token overlap.

**The disclosure fork is the hard part.** Many releases go to one requester
privately. Public resolutions may feed the requester-facing path; private
ones may only inform staff-side triage and routing. If that fork is not
explicit from the start, this feature becomes a disclosure bug.

### Phase 4 — retrieval-augmented triage and routing

Prompts are static today: `buildIntakeTriageUser` takes only `{ rawText }`.
Request #10,000 gets a byte-identical prompt to request #1. With phases 2–3
in place, intake can retrieve the k nearest *resolved* requests and pass their
asks, scopes and routing outcomes as few-shot context. No fine-tuning, no
training pipeline — retrieval-augmented, versioned in `/src/ai/prompts/`, and
measurable through `npm run eval` like every other prompt change.

## What this does NOT solve

Worth stating because it is an easy assumption to make: **the learning loop
makes the system better at understanding the ask. It does not make it better
at filtering by date.** That is a query-layer capability, not something
accumulated pairs will ever teach. Both are needed; neither substitutes for
the other.

Likewise, none of this is model training. Nothing here fine-tunes anything.
The compounding asset is a query→document alias table that the request
workflow generates as a byproduct — and, unlike a fine-tune, every entry in it
is attributable to a named human decision that is already in the audit log.

## Related

- `docs/agentic-horizon.md` — **B1, the proactive-disclosure librarian**, is
  the queue-wide agent that mines these same signals (requests, deflections,
  answer-box misses) to propose what to publish next. Phase 5; gated.
- `docs/records-ingestion.md` — how a city data store becomes searchable
  corpus in the first place.
- `docs/invariants.md` — invariant 3 is the constraint that shapes phase 3.
