# Network plays — cross-tenant learning without cross-tenant leakage

Status: **LIVE END TO END, off for every tenant until an admin opts in**
(design, functions, consent surface, table, weekly job, and the first read
surface all 2026-08-15). Remaining: comparative metrics on /app/reports, and
exemption benchmarking last of all.

**Seeding an aggregate means seeding what it aggregates.** The demo fixture
first wrote peer rows straight into `request_plays`, reasoning that plays are
a rebuildable aggregate so seeding them directly was harmless. It is not: the
nightly sweep runs `rebuildAgencyPlays` — a FULL REPLACE derived from closed
requests — *before* the network rebuild, so directly-seeded plays are erased
on the first boot after seeding and every benchmark silently vanishes. The
peers now carry real closed requests with done tasks (a route needs a done
task, or the benchmark can state timing but not routing).
big-ticket §1's first move, deliberately taken while the network is small:
the rules are cheap to get right now and expensive to retrofit once tenants
have contributed data under a promise we later have to change.

The stability rule needed one thing the design didn't anticipate:
`network_aggregates.pendingAgencyCount`. Holding a group whose agency count
moved LIVELOCKS without it — the hold re-publishes the old row, next cycle
compares the unchanged stored count against the new candidate, holds again,
and the benchmark freezes permanently the first time an agency joins. The
column remembers which count is being waited on so the hold lasts exactly
one cycle. A count is safe to store; the contributing SET is not.

**All four ⚑ decisions answered by the owner, 2026-08-15:**
contribute-to-read · weekly rebuild · floors 5 agencies / 20 episodes / 0.4
max share · **the aggregate IS a public record** — which added the
"contributions are ephemeral" clause to invariant 11 (see ⚑4 below; it is
the one answer that changed the design). Built:
`src/domain/networkVocabulary.ts`, `src/domain/networkPlays.ts`,
`src/domain/networkPlays.test.ts` (26 tests).

The hard rules extracted from this document live in **invariant 11**
(`docs/invariants.md`). Where the two ever disagree, the invariant wins.

⚑ marks a decision that is the owner's (or counsel's), not the
implementer's — the convention `docs/connected-sources.md` established.
Each carries a recommendation so the decision is a yes/no, not an essay.

## The bet

Every incumbent FOIA install is an island. Brandeis is multi-tenant with a
learning loop already distilling each agency's closed requests into **plays**
(`docs/learning-loop.md`). The moat is letting tenants learn from *each
other*:

> "Building-permit requests route to Public Works and close in a median of 6
> days across 40 California agencies."

A brand-new tenant would inherit the network's institutional memory on day
one, instead of needing a year of its own closed requests before the
learning loop says anything useful. That cold-start fix is the product
argument. The strategic argument is that a competitor with separate
single-tenant installs **cannot copy it at any price**, and it compounds with
every tenant added.

Two further uses fall out of the same substrate:

- **Exemption-practice benchmarking** — "agencies in your state cite this
  section on 8% of police records; you cite it on 41%."
- **Comparative transparency metrics** — "median 8 days, faster than 70% of
  comparable agencies."

## Why this needs an invariant before it needs a migration

The naive version of this feature is one line of thinking: *plays are already
anonymized aggregates, so just pool them.* That is wrong, and it is wrong in a
way that is invisible until it has already leaked.

**A play's `topic` is literally request text.** In `src/domain/caseLearning.ts`:

```ts
topic: keywords.slice(0, 3).join(" "),
```

`keywords` are the highest-signal terms lifted from the requester's own
wording. So a play for a rare request — "riverside sinkhole settlement acme" —
carries a near-verbatim fingerprint of one filing, at one agency, on one
date. Pooling plays as they exist today would ship requester language across
a tenant boundary while feeling like statistics. Any design here has to start
by assuming *every tenant-derived string is request text until proven
otherwise*, because in this codebase it usually is.

### Threat model

Five ways a well-meaning aggregate leaks. The design answers each.

1. **Rare-topic re-identification.** A cluster of one unusual request is
   identifying even with no agency label attached — the topic *is* the
   identifier. → Controlled vocabulary + population floors.
2. **Embedding inversion.** Play rows carry a centroid vector (v2). Over few
   members the centroid approximates a single request's vector, and
   approximate text is recoverable from vectors. A vector is not an anonymous
   number; it is compressed text. → Vectors never cross, full stop.
3. **Small-cell disclosure.** "1 agency in your state cites §X on 100% of
   police records" is one agency's practice, attributable by anyone who
   knows the tenant list. → Floors on agencies *and* episodes, plus a
   dominance cap so "5 agencies" can't mean "one agency and four rounding
   errors."
4. **Differencing over time.** An observer who sees the aggregate before and
   after a known agency joins or leaves can subtract to recover that agency's
   contribution. → Full-rebuild cadence with suppression, and ⚑2 below.
5. **Adversarial use of the honest answer.** Exemption benchmarking is
   *designed* to reveal that an agency is an outlier — that is the value.
   But the same number is litigation ammunition against the contributing
   agency. This is not a bug to engineer away; it is the reason consent must
   be explicit, informed, and revocable rather than a buried default.

The last one deserves emphasis because it is a product decision disguised as
a privacy decision: **we are asking agencies to contribute data that could be
cited against them.** The only honest posture is opt-in with the tradeoff
stated plainly in the consent copy.

## The load-bearing design move: controlled vocabularies

The tempting implementation is to *scrub* tenant strings before sharing —
strip names, drop rare terms, filter PII. Scrubbing is a denylist, and
denylists fail open: the one term nobody thought of is exactly the one that
identifies someone.

Instead, **nothing tenant-authored crosses at all.** A contribution is
assembled only from symbols in fixed vocabularies the platform defines:

| Crosses | Shape | Why it's safe |
|---|---|---|
| Topic code | enum, e.g. `building_permits` | Platform-defined; carries no requester wording |
| Department role | enum, e.g. `public_works` | Not the tenant's department name or uuid |
| Statute section | canonical citation from the state profile | Already public law, already a fixed list |
| Outcome shares | bucketed | No exact counts to difference against |
| Days-to-close | bucket, not the exact median | Same |
| State code | 2 letters | Needed for comparability; not identifying alone |

A play that cannot be mapped onto a topic code **does not contribute** — it
is dropped, not passed through with a free-text fallback. That single rule is
what converts an unwinnable scrubbing problem into a winnable mapping
problem, and it means the leak surface is the size of the vocabulary rather
than the size of the corpus.

The mapping itself (`play → topic code`) is deterministic and local: it runs
inside the tenant, and only its *output symbol* leaves. Unmapped plays being
dropped is expected and healthy — early on, most will be, and the network
simply stays quiet until it has something floor-clearing to say.

### Explicitly never crossing

Named here because a future reader needs to see them refused, not infer it:
request `raw_text` and `interpreted_scope`; play `topic` and `keywords`;
`samplePublicIds`; `departmentId`, `agencyId`, any uuid; staff-authored
exemption *labels* (as opposed to canonical statute sections — labels are
free text and can contain anything a clerk typed); document filenames or
content; staff and requester identities; **embedding vectors**; and any exact
count below the floors.

## Consent

- **Off by default**, forever. A tenant that never looks at the setting never
  contributes.
- **Opt-in per agency**, performed by a named admin, recorded in the
  append-only admin log with the actor — the same shape as every other
  consequential toggle in the product.
- **Revocable at any time.** The next rebuild excludes the agency entirely.
- **Honest about what revocation can and cannot do.** Aggregates already
  computed and displayed are not retracted; they were floor-cleared and
  non-attributable by construction. Promising true retraction would be a
  promise the architecture cannot keep, and the consent copy should say so
  rather than imply otherwise.

✅ **1 — Contribute-to-read** (owner, 2026-08-15). No free-riding on other
agencies' disclosure; the value exchange is legible in the consent dialog.
Enforced at the read side when it is built — the projection functions are
already consent-gated on the write side.

✅ **2 — Weekly rebuild** (owner, 2026-08-15), not continuous. Continuous
recomputation is the differencing attack's best friend. The rebuild job
should also suppress an aggregate whose contributing-agency set changed
since the prior publication until it clears the floors again.

✅ **3 — Floors: `MIN_AGENCIES = 5`, `MIN_EPISODES = 20`,
`MAX_AGENCY_SHARE = 0.4`** (owner, 2026-08-15). Live in
`src/domain/networkPlays.ts` as exported constants, referenced by name in
invariant 11. Conservative on purpose: loosening later is a one-line change,
tightening after tenants have relied on looser numbers is a broken promise.

✅ **4 — YES, the aggregate is a public record** (owner, 2026-08-15). Three
consequences follow, and the first one changed the design:

1. **Contributions must never be persisted** — now a clause of invariant 11.
   If the aggregate is disclosable, anything stored beside it can be asked
   for too. The per-agency contribution is the one artifact that names its
   source agency *and* carries exact counts, so a stored contribution set
   would reverse the anonymity of every aggregate built from it. Compute in
   memory during the weekly rebuild; store only aggregates. Cheap to
   guarantee now, effectively impossible to retrofit after a table exists
   and has history in it.
2. **The floors are now load-bearing in a stronger sense.** They were
   protecting against a curious tenant; they are now the only thing between
   a FOIA request and per-agency practice data. The values stand (5 / 20 /
   0.4, plus the stricter per-section agency floor), and this is the
   argument against loosening them casually later.
3. **Publish proactively rather than wait to be asked.** This is the whole
   product thesis applied to ourselves — a record that will be requested
   should already be published (`docs/transparency-impact.md`). It also
   turns a disclosure obligation into the comparative-benchmark surface
   big-ticket §1 already wanted. Product opportunity, not an obligation to
   rush: the read side still ships routing hints first and benchmarking
   last.

**One tension this creates, for the record.** Public records carry retention
duties, which argues for keeping historical aggregates; but a *series* of
weekly aggregates is exactly what a differencing attack wants — watch an
agency join or leave between two snapshots and subtract. These are
reconcilable, and the reconciliation is already in ⚑2: keep snapshots
immutable and dated (retention satisfied), and suppress publication of any
aggregate whose contributing-agency set changed until it clears the floors
again (differencing blunted). Whoever builds the weekly job should treat
that suppression rule as load-bearing rather than an optimization.

**Still worth asking counsel:** if the aggregate is a public record of each
*participating* agency (vendor-held records on an agency's behalf are the
agency's records in many states), then each agency may be asked for it
individually — which makes the "no agency is identifiable" property
something each participant is relying on when they answer. That strengthens
the design rather than threatening it, but it belongs in the consent copy.

## Scope for v1

**Single deployment only.** "The network" means the consenting tenants on
*this* instance. Federating across self-hosted deployments needs a transport,
key management, and a mutual-trust story — an enormously larger security
surface for the same product claim. Explicitly out of scope; revisit only
with real demand.

This fits the self-contained-first preference: no new service, no external
dependency, and the whole feature degrades to "nothing" on a single-tenant
deployment rather than breaking.

## Architecture sketch (for the build session, not built here)

Follows the `request_plays` idiom exactly, which is the point — this is a
**rebuildable projection of a projection**, never an incrementally mutated
store:

```
request_plays (per agency, already exists)
      │  local, deterministic; unmappable plays dropped
      ▼
toNetworkContribution(play, profile) → NetworkContribution | null   [pure]
      │  allowlist + controlled vocabulary; the invariant-11 chokepoint
      ▼
   consented agencies only  ─── revocation excludes here
      ▼
publishableAggregates(contributions) → NetworkAggregate[]           [pure]
      │  floors + dominance cap; withhold, never pad
      ▼
network_aggregates (platform-level, no agency_id — the demo_requests idiom)
      ▼  read side, advisory only
   cold-start routing hints · exemption benchmark · comparative metrics
```

Two pure functions carry the entire invariant, which is deliberate — it is
the `computeDueDate()` pattern applied to a privacy rule: no I/O, no clock,
config as arguments, exhaustively testable, and impossible to bypass by
accident because the only path to the network table runs through them.

**Built 2026-08-15** — `toNetworkContribution` + `publishableAggregates` as
pure functions with property tests, *before* any table exists. An invariant
with no test is a wish, and these two are testable with zero schema.

### What building them taught (three real bugs the tests caught)

Worth recording, because each is silent and each would have degraded the
network's data quality rather than crashing:

1. **A plural trigger term never matches the singular name.** The role
   vocabulary said `"streets"`, so `"Street Maintenance"` mapped to nothing
   and that agency's routing simply vanished from the aggregate. Substring
   triggers must always be the SHORTER form.
2. **Length is not specificity.** Scoring role matches by term length made
   `"Police Records"` resolve to *clerk*, because `"records"` (7 chars) beat
   `"police"` (6). Replaced with explicit per-term weights — a role-defining
   noun outranks a generic one regardless of length.
3. **A generic supporting term can win alone.** Unweighted term counting let
   a play about an annual budget report match the bare term `"report"` under
   `police_incident_reports` — the only match, therefore the winner. Hence
   weighted terms plus `MIN_TOPIC_SCORE`: supporting terms may only tip a
   decision that defining terms already support.

The through-line: for a vocabulary, **a false mapping is worse than no
mapping.** No mapping drops one agency's contribution; a false one pollutes
every other agency's benchmark with data that isn't about their topic. Every
ambiguity in these functions resolves to null for that reason.

### One structural guarantee worth understanding before changing it

Invariant 11 says a network signal may never auto-dispatch on its own. The
obvious implementation is a numeric cap — and it does not work: an agency
sets its own `autoDispatchConfidence` (default 0.8, but any value ≥ 0 is
permitted), so *no* constant we pick is guaranteed to sit below every
tenant's bar.

So the guarantee is **structural instead**: `networkRoutingHint` returns a
`NetworkRoutingHint`, deliberately NOT the `LearnedRoutingSuggestion` that
`autoDispatchSuggestions` consumes. Routing a network hint into the dispatch
path is a compile error, not a policy violation. `NETWORK_CONFIDENCE_CAP`
(0.6) exists only to rank hints below local plays in the UI. If someone
later "simplifies" the hint type into a LearnedRoutingSuggestion to reuse a
component, the invariant silently breaks — that refactor is the one to
refuse.

### Read side ranking rule

Local plays cap learned-route confidence at **0.9** in code
(`docs/learning-loop.md`). Network-derived suggestions must rank strictly
below that — recommendation **0.6**, and never sufficient for auto-dispatch
on their own. Other agencies' history is real evidence but weaker evidence
than your own, and the code should say so rather than relying on a comment.

## Invariants kept

- **11** — this document's whole subject.
- **2** — an aggregate that clears every invariant-11 clause is not agency
  A's data; anything that fails one is, and stays isolated.
- **3** — nothing here touches a requester-facing surface. Network signals
  are staff-side only.
- **4** — network signals propose; a named human still approves everything
  legally significant.
- **9** — no classification flip anywhere in this design.
- **5** — contributions are distilled FROM the append-only record; nothing is
  written back to it beyond ordinary proposal-card events.

## What would make this real

1. ~~The two pure functions + property tests (no schema).~~ **DONE
   2026-08-15.**
2. ~~The topic-code vocabulary.~~ **STARTER SET DONE** — 26 topic codes, 14
   department roles, weighted terms. This stays the piece worth the most
   care: it is product judgment, not engineering, and it should be revisited
   against real play data before the network publishes anything. Widening it
   is additive and safe.
3. ~~Consent surface + admin-log event~~ **DONE 2026-08-15.**
   `settings.networkPlays`, `NetworkPlaysPanel`, `setNetworkPlaysAction`,
   `network_consent_changed` in the append-only admin log with the acting
   human's name. The panel states the tradeoff plainly and near the top —
   including that these figures could be cited in an appeal involving a
   participant, and that the aggregate is a public record. Keep it that way;
   consent that hides the cost is not consent.
4. ~~`network_aggregates` table + weekly rebuild job~~ **DONE 2026-08-15**
   (migration 0018, `networkPlaysService.rebuildNetworkAggregates`, wired
   into the nightly sweep but gated WEEKLY by its own `network_rebuild`
   admin event — the B2 consistency-audit idiom). The two invariant-11
   rules that live in the caller rather than the pure functions are both
   honored and commented at their site: contributions exist only inside the
   marked ephemeral zone of the rebuild and are never persisted, logged, or
   returned; and the store is full-replace, one current snapshot, never a
   published series.

   **Revision to the original plan, worth knowing.** The design said "store
   dated immutable aggregates" to satisfy the retention duty. Built as
   full-replace instead: a dated series is precisely what a differencing
   attack subtracts across, and the aggregate is rebuildable from the record
   at any time, so retaining a series buys nothing and costs anonymity. The
   honest position is that the current aggregate IS the record.
5. Read side, in this order: ~~cold-start routing hints first~~ **DONE
   2026-08-15** (`networkHintForRequest` + the "Across other agencies" card
   on the request page); comparative metrics second; exemption benchmarking
   last — it is the highest-sensitivity surface and should ship only once
   the network is well past the floors.

   Two mappings the read side needed that the write side never did:
   `toTopicCodeFromText` (aggregates are keyed by topic code; a coordinator
   has prose) and `localDepartmentsForRole`, which resolves a network role
   back to THIS agency's department for display by running
   `toDepartmentRole` in reverse — so the two directions can never disagree.
   The resolved department is display-only and must never be assembled into
   anything `autoDispatchSuggestions` accepts; that shortcut is precisely
   what would undo the structural guarantee.

Note that nothing in steps 3–5 can leak anything on its own: every path to a
tenant-readable number runs through the two functions built in step 1, and
they refuse by default.
