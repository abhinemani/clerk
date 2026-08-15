# Invariants — rules that must never be weakened

These are load-bearing legal and trust guarantees, not preferences. If a feature can't
be built without violating one, the feature changes — the invariant doesn't. Never
disable, skip, or loosen these tests to get a build green. Each invariant has (or must
get, when its subsystem is built) an automated test; treat those tests as append-only.

## 1. True redaction
Released artifacts contain no recoverable redacted content. Test: run text extraction
on every finalized redacted PDF in the test suite and assert the redacted strings are
absent — from the text layer, metadata, and embedded objects. Overlay-only redaction
is forbidden in any code path, including "temporary" or "preview" ones that could ever
be delivered.

## 2. Tenant isolation
No query, job, search index, or file URL can return agency A's data in agency B's
context. Test: attempt cross-tenant reads through every public interface (API routes,
server actions, search, signed URLs) and assert failure. New endpoints must add
themselves to this test.

## 3. Public-only retrieval for requesters
Requester-facing retrieval (answer engine, archive, portal search) is hard-scoped to
classification = 'public' in the query layer — never enforced only by prompt or UI.
Test: seed internal documents with distinctive marker strings; assert no requester-
facing surface can ever return them. This is a hard fail, not a score.

## 4. Human approval on legally significant actions
Releases, denials, extensions, fee estimates, redaction finalization, and any
requester-facing substantive communication require an approving user_id, enforced at
the action layer. No configuration flag, agent tier, admin setting, or env var may
bypass this. Test: invoke each action without an approver and assert rejection.

## 5. Append-only audit log
RequestEvent rows are never updated or deleted by application code. Every state
change, AI run (with prompt version), approval, and delivery writes an event. Test:
no update/delete statements target the table (static check) + runtime guard.

## 6. Immutable requester input
Request.raw_text is never modified after submission. AI interpretation lives in
interpreted_scope; the original is evidence.

## 7. Deadline computation is deterministic and logged
computeDueDate() is a pure function of (statute config, calendar, received_at).
Every computed or extended deadline persists with its basis. Changing a state profile
requires updating that state's golden-date test cases.

## 8. Release integrity
A Release is immutable once delivered: artifacts are checksummed at creation, and
served bytes must match. Corrections are a new Release, never an edit.

## 9. Classification only ratchets safely without a human
No automated process (pipeline, agent, sync) may reclassify a document from internal
to public. That direction always requires a named human action, logged.

## 10. AI output provenance
Every AI-generated artifact (draft, suggestion, classification, summary) is marked as
AI-generated in the data model and traceable to a pipeline run in RequestEvent. Nothing
AI-generated is presentable to a requester while marked unapproved.

## 11. Cross-tenant aggregation is consented, floored, and advisory
Design doc: `docs/network-plays.md`. This invariant governs every feature that lets one
tenant's history inform another's — it is written BEFORE the first such feature ships,
per the standing rule that cross-tenant aggregation gets its own invariant before its
first migration.

**Consent.** No tenant contributes to any cross-agency aggregate without an explicit,
per-agency opt-in performed by a named admin and recorded in the append-only admin log.
Default is off. Opt-in is revocable at any time; the next rebuild must exclude a revoked
agency entirely.

**Allowlist, never denylist.** What crosses a tenant boundary is limited to a closed set
of fields drawn from CONTROLLED VOCABULARIES — canonical topic codes, canonical
department roles, canonical statute sections, and bucketed numerics. Tenant-authored
free text and tenant-local identifiers never cross, and that specifically includes
request text, `interpreted_scope`, play `topic`/`keywords` (which are derived from
request text), staff-authored exemption labels, `samplePublicIds`, any uuid, filenames,
staff or requester identities, and **embedding vectors** — a centroid over few members
approximates its members and is text in disguise, not an anonymous number. A
contribution that cannot be mapped onto the controlled vocabulary is dropped, never
passed through.

**Population floors.** A published aggregate must draw on at least `MIN_AGENCIES`
distinct consenting agencies and `MIN_EPISODES` total episodes, with no single agency
contributing more than `MAX_AGENCY_SHARE` of it. An aggregate failing any floor is
WITHHELD ENTIRELY — never rounded, padded, blurred, or partially disclosed into
existence. Suppression is the only permitted response to a thin cell.

**Contributions are ephemeral.** The per-agency contribution — the only artifact that
names its source agency and carries exact counts — is computed in memory and never
persisted, logged, cached, or exported. Only aggregates are stored. This is not tidiness:
the owner's counsel position (2026-08-15) is that the aggregate IS a public record, so
anything stored beside it may be asked for too, and a stored contribution set would
de-anonymize every aggregate built from it. The guarantee has to be that the data does
not exist at rest, not that we decline to serve it.

**Advisory only.** A network-derived signal may inform a suggestion a named human reads.
It may never: satisfy invariant 4's approval requirement, trigger an automated dispatch
on its own, raise an automated confidence at or above the local learned-play cap (other
agencies' history is weaker evidence than your own, and must rank that way in code), or
reach any requester-facing surface — invariant 3 remains the outer wall.

**Relationship to invariant 2.** Tenant isolation is not weakened here. An
invariant-11-compliant aggregate is not agency A's data: it is a statistic that provably
cannot be attributed to A. Everything that fails any clause above remains A's data and
invariant 2 applies to it unchanged. If the two ever appear to conflict, invariant 2
wins and the aggregate is withheld.

Test: property tests over the projection function assert that no output field contains
any input request text, publicId, uuid, or vector, and that unmappable inputs yield
null; floor tests assert withholding at each floor minus one, including the
single-dominant-agency case; a revocation test asserts the following rebuild excludes
the revoked agency's contribution entirely; a ranking test asserts network-derived
confidence sorts below the local cap and never auto-dispatches.