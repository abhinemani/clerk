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