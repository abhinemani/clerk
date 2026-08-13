# Answer-first search, and the loop that makes it compound

Status: **phases 1–3 shipped 2026-08-13.** Date-aware retrieval, the
ask-alias loop, and the GenAI matcher over a pluggable search index. Phase 4
(RAG'd triage prompts) is specified, not built.

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

### Phase 3 — the query layer: retrieve, then judge

Three stages, in `src/services/priorAnswerService.ts`:

**1. Scope.** Build the candidate set this audience may see — and do it
FIRST. For a requester, prior requests whose records were released privately
never enter the candidate list, so they are not in the retrieval corpus, not
in the prompt, and not in the model's context. Filtering after the model
would leave private scopes sitting in a prompt, which is a disclosure risk
even when the output is thrown away: invariant 3 governs what the query layer
can *reach*, not only what it returns. Two independent gates — the release
must have been public AND the document must still be classified public today,
so an audited unpublish is honoured rather than remembered wrongly.

**2. Retrieve** via the `SearchIndex` adapter (`src/adapters/searchIndex.ts`),
narrowing to eight candidates.

- **Built-in: real BM25**, with ask aliases scored as a separate boosted
  field. This replaces "+1 per query term appearing anywhere", which had no
  term weighting, no length normalisation and no saturation — a long document
  mentioning "contract" nine times beat a short one that was *about* the
  contract. Zero services; this is the default.
- **Elasticsearch / OpenSearch**, opt-in via `ELASTICSEARCH_URL`, fetch-only
  (no SDK, same rule the email providers follow). It **falls back** to
  built-in on any error, because search is a read path and a cluster being
  down must not stop a resident finding a record we already publish. It also
  can never *widen* the result set: anything it returns that is not in the
  caller's scoped corpus is dropped, so a stale or over-broad cluster index
  cannot become a disclosure path. **Not yet run against a live cluster** —
  treat the query shape as a starting point, not a tuned configuration.

**3. Judge** with `request_match` (`src/ai/pipelines/requestMatch.ts`) — the
GenAI half. The prompt is written for precision, not recall: cheap retrieval
already has the recall, and the model's job is to reject candidates that
merely *look* similar. A false positive tells a resident "here is your
answer" and hands them the wrong records, and they may never file the request
they actually needed. Returns `full` / `partial` coverage with a confidence
and a rationale a resident can read.

Two floors, because the cost of being wrong differs by audience:
`REQUESTER_MATCH_FLOOR = 0.72` and `STAFF_MATCH_FLOOR = 0.45`. A match naming
a `publicId` that was not offered is discarded — an invented id must never
reach a resident as a real record.

Runs at the moment the archive comes up empty, which is the moment before
filing. Not on every keystroke: the judge costs a model call, and that is the
one point where its answer changes what the person does next.

**Degradation, all the way down.** No Elasticsearch → BM25. No
`ANTHROPIC_API_KEY` → retrieval-only, returning the single best hit marked
*unjudged* rather than implying a precision it did not earn. Model error →
no matches and filing proceeds. A matcher must never be the reason a request
cannot be filed.

**Still open:** `requests.embedding` is still unwritten. BM25 plus alias
boosting plus the GenAI rerank covers the flagship cases, but pure semantic
retrieval ("sweepers" ↔ "cleaning" with no shared token and no alias yet)
still depends on the alias loop having seen that phrasing once.

## What is specified and NOT built

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
