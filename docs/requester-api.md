# Requester API + MCP server — the machine door onto the public portal

Shipped 2026-08-14 (big-ticket board §2, first slice; graduates the status
API from "first brick" to a usable agent-to-agent surface — the §16.4 bet,
cashed in early). A resident's or newsroom's AI assistant can now do the
whole requester loop against an agency's portal: search the published
archive, read a record, file a request, and track it — over plain JSON or
over MCP.

## The two rules (same family as the status API's)

1. **Projection only.** Every byte served already flows through a portal
   page an anonymous visitor can load. Archive search and record reads sit
   on `lib/archive` (invariant 3 hard-scopes retrieval to
   `classification='public'` in the query layer); status is
   `publicRequestStatus` (the tracker's projection — nothing about the
   requester, no raw text, no correspondence). Enabling the API **never
   widens what a requester can see** — it changes the format, not the
   audience.

2. **Filing is the real thing.** `file_request` / `POST /requests` rides
   `intakeService.submitAndDispatch` — the exact chain the portal form uses
   (real public id, statutory deadline, audit events, routing rules, play
   routing, triage job, duplicate check). One filing path, two front doors;
   the chain was extracted from the portal action precisely so a second
   entry point could never fork it.

## Opt-in

`settings.requesterApi = { enabled, filingEnabled }` (jsonb — no migration),
set from the admin page's "Requester API & MCP server" card. Absent/off ⇒
every route plays dead with 404, the status-API idiom. `filingEnabled` is a
separate toggle (default on when the API is on) because filing is the one
write. Enabling `requesterApi` also opens the existing status route — a
request filed by machine must be checkable by machine without a second
toggle.

## REST surface (`/api/v1/{slug}/…`)

| Route | Gate | What |
|---|---|---|
| `GET /archive?q=…` | `requesterApi.enabled` | Public archive search (`searchArchiveDetailed`): plain-language query incl. time windows; items with download/record paths, ask aliases, connected-source stamps. |
| `POST /requests` | `… && filingEnabled` | File a request: `{text, name?, email?}` → `201 {trackingNumber, statutoryDueAt, statusApiPath, trackPath}`. Rate-limited. |
| `GET /requests/{publicId}` | `statusApi.enabled` **or** `requesterApi.enabled` | The tracker projection (pre-existing route, gate widened). |

Paths in responses are origin-relative (the client knows the origin it
called). Errors are `{error}` JSON; unknown/disabled agencies are
indistinguishable from nonexistent ones.

## MCP endpoint (`POST /api/v1/{slug}/mcp`)

Streamable-HTTP transport, **stateless**: each POST is one JSON-RPC message
answered with JSON; no sessions, no SSE (GET is 405, which the spec allows);
JSON-RPC batching refused (removed in protocol 2025-06-18). Implementation
is hand-rolled in `src/mcp/server.ts` (~150 lines, offline-tested) — the
self-contained-first rule; no SDK dependency. Protocol versions 2025-06-18
and 2025-03-26 are accepted at initialize.

Tools (`src/mcp/requesterTools.ts`, deps-injected and offline-tested):

- `search_records {query}` — archive search; descriptions steer agents to
  search **before** filing (deflection posture, now machine-shaped).
- `get_record {id}` — one public record incl. extracted text (truncated at
  6000 chars; non-public ids behave as nonexistent).
- `get_request_status {trackingNumber}` — the tracker projection.
- `file_request {description, requesterName?, requesterEmail?}` — only
  registered when `filingEnabled`; description says out loud that this is a
  legal act with a statutory deadline.

Tool *execution* failures return MCP `isError` results (the model reads and
adapts); only protocol misuse gets JSON-RPC errors.

Try it (seeded demo has the API on):

```sh
curl -s localhost:3000/api/v1/riverton/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Claude Code: `claude mcp add --transport http riverton http://localhost:3000/api/v1/riverton/mcp`.

## Rate limiting

Filing only (reads are cheap public reads): fixed-window in-memory limiter
(`SignupRateLimiter` reused), keyed `slug:first-forwarded-hop`, 5/hour per
key + 200/hour global, shared by the REST route and the MCP tool. In-memory
is accepted for an anti-flood guard (restart resets it — signup posture);
revisit if a real deployment multi-processes.

## Deliberately NOT in v1

- **No auth / API keys.** The surface is anonymous-public by construction;
  keys would imply entitlements that don't exist. If quota tiers are ever
  needed, that's the moment to add keys.
- **No model calls.** Search is the deterministic hybrid ranker; the answer
  engine / requester agent stay portal-side. The MCP client brings its own
  model — that's the point of MCP.
- **No SSE / sessions / resources / prompts** — tools-only, stateless.
- **No cross-tenant discovery.** One endpoint per agency; the network-level
  registry is big-ticket §1 territory and needs its own invariant first.

## Files

Core: `src/mcp/server.ts` + `src/mcp/requesterTools.ts` (+ tests) ·
`src/services/requesterApiService.ts` (config/limiter/fileViaApi, tested) ·
`src/services/intakeService.ts` (the extracted shared chain) · routes under
`src/app/api/v1/[agency]/{archive,requests,mcp}` · admin card
`RequesterApiPanel` + `setRequesterApiAction`.
