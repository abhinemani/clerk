# The strategic horizon (§16.4 — document, don't build)

This is a design note, not a work item. Per spec §16.4, we record the decision
and its rationale so the codebase is standing in the right place when the
machine-to-machine world arrives.

## The bet

Requester-side automation is coming regardless — bulk auto-filed requests,
auto-appeals, day-11 auto-follow-ups. Agencies without agentic capacity get
buried; agencies with it absorb machine-scale demand. The endgame is
machine-to-machine fulfillment: a requester's agent negotiating scope against the
agency's agent and the public corpus, most "requests" resolving in minutes with
no human on either side.

## The cheap decision we make now

Keep the **ingestion and read APIs clean and documented** so they can later serve
as the agent-to-agent interface. Concretely, and consistent with §9.4:

- The §9.1 ingestion REST API (`POST /api/v1/{agency}/records`) and the read API
  for requests/releases are the same surface a counterpart agent would call.
  Treat them as public contracts: versioned (`/api/v1`), idempotent on external
  ID, and documented.
- The public corpus (`classification = 'public'`) is the shared substrate both
  sides negotiate over. The requester-side agent (§16.1) is already hard-scoped
  to it; a future external agent gets the same scope through the same query layer.
- Every autonomous action remains attributable and budget-capped (§16.2–16.3),
  so "an agent did this" is always answerable — a precondition for trusting
  agent-to-agent traffic.

## What we are explicitly NOT building yet

No negotiation protocol, no external-agent authentication beyond the existing
per-Source API keys, no auto-appeal handling. The data plane is the precondition
for that world; this product should be able to serve it without a re-architecture
when it comes.
