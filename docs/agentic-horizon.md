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

---

# Candidate agents & capabilities beyond §16.1

Brainstormed 2026-07-29. Two buckets with very different rules:

- **Bucket A — wire-ups of already-built §6 pipelines.** Not Phase 5. These are
  sanctioned AI-layer work, buildable in normal sessions, each ~one session.
- **Bucket B — new agent concepts.** Phase-5 territory: document here, do NOT
  build until Phase 5 opens. Each entry names its tier ceiling (§16.3), its
  governing invariants, and the existing scaffolding it would stand on — so
  when Phase 5 opens, these are configurations over the existing framework
  (definitions.ts allowlists + budgets), not new architecture.

Everything below honors the house rules: AI proposes / staff disposes, no
internal→public flip without a named human (invariant 9), every action
attributable and budget-capped, and self-contained by default — an agent that
wants an external service must degrade gracefully without it.

## Bucket A — dormant pipelines to wire (buildable now)

**A1. Coordinator copilot (§6.8) — the highest-leverage wiring left.** The
pipeline exists (`src/ai/pipelines/copilot.ts`) and returns `proposedActions`;
what's new is that the action surface finally exists to receive them: draft
message → CorrespondencePanel composer; propose extension → ExtensionPanel;
propose dispatch → routing card. A chat pane on the request detail whose
proposals render as the standard Accept/Edit/Dismiss cards. No new invariants
needed — every proposal lands on an existing named-human action.

**A2. Pre-release residual check as a release gate.** `residualCheck.ts` exists
(the §6.5 "missed PII on the final artifact" inverse pass) but nothing calls
it. Run it inside `releaseRequest`/`finalizeRedaction` over the outgoing
artifact text; findings render as a warning the approver must explicitly
override (logged). Cheap, deterministic, closes a stated spec requirement.

**A3. Duplicate & related requests at intake (§6.2).** The dedup library and
`requests.embedding` column exist. Two surfaces: (1) staff — "this request
overlaps PR-2026-00292 (released 2026-03-01)" card with a link to the prior
release; (2) requester — at filing time, "records matching your request were
already released" → the strongest deflection moment in the product, and it
feeds the deflection ROI metric that already exists.

**A4. Auto-classification on ingest (§6.5).** `classifyDocument.ts` exists;
run it in the upload/email-in job chain alongside the exemption pass: record
type, suggested metadata, sensitivity pre-flag. Suggestions only — and per
invariant 9 it may propose `public` but never set it.

## Bucket B — new agent concepts (Phase 5; document, don't build)

**B1. Proactive-disclosure librarian (queue-wide, Tier 2 ceiling).** Mines the
request archive, deflection log, and answer-box misses for demand patterns:
"4 requests + 11 unanswered searches about towing contracts this quarter —
publish the series." Proposes archive publications; a named human performs the
actual classification flip (invariant 9 is the whole design). This is the
agent that compounds the platform's core ROI loop: every acceptance makes the
answer box deflect more. Stands on: deflections table, archive metadata,
chunk-0 embeddings.

**B2. Consistency auditor (queue-wide, read-only Tier 1).** Cross-request
defensibility: same record type, inconsistent treatment — "officer names
redacted under privacy in PR-104 but released in PR-131." Inconsistency is
what loses appeals. Reads reviews, redaction exemption logs, and release
letters; emits admin_events + a weekly digest. Never touches decisions.
Stands on: the exemption logs finalizeRedaction already writes.

**B3. Appeal-defense packet builder (per-request, Tier 1 + one Tier-2 send).**
On denial or on demand, assembles the dossier counsel needs: the append-only
timeline, deadline computation bases (invariant 7 pays off here), exemption
citations with rationales, every letter — into one exportable packet with an
AI-drafted narrative cover memo. The audit log was built for exactly this
moment; this agent is its reader.

**B4. Third-party notice steward (per-request, Tier 2).** Many statutes
require notifying an outside party (vendor trade secrets, personnel records)
before release, with their own response windows. Agent detects implicated
parties in the review set, drafts the statutory notices, tracks the windows
alongside the main clock. Needs: third-party-notice rules added to state
profiles (data, not code — §7 pattern), and the correspondence machinery it
would ride already exists. Nobody's tooling does this well; it's a real
differentiator.

**B5. Records-inventory interviewer (data-plane, Tier 2).** Email-native:
periodically interviews department responders through the email-in loop
("which systems hold your inspection records? who owns the bodycam archive?")
and accretes a per-department records map. The map becomes few-shot context
for routing (§6.3 explicitly wants this signal) and eventually the substrate
for §6.4 responsive-records search. The email round-trip it needs shipped
2026-07-29.

**B6. Retention-hold sentinel (queue-wide, Tier 1 flags).** Cross-references
open requests against a retention schedule; when requested records approach a
scheduled destruction date, proposes a legal hold. Destroying requested
records is the catastrophic FOIA failure mode. Needs a small retention-
schedule model per record type (new data, worth it).

**B7. Surge watchdog (queue-wide, Tier 1).** Detects request storms: a news-
event topic spike ("6 requests about the Main St incident this week — prep a
proactive posting", feeds B1) or a single-requester flood (propose lawful
consolidation where the statute permits it — cite-or-silent, never invent a
basis). Also the natural home for detecting the §16.4 machine-filed-bulk
future arriving.

**B8. Agency onboarding concierge (platform, Tier 2).** Interview-driven
setup for a new tenant: departments and responder emails, observed holidays,
statute profile walkthrough ("CA gives 10 calendar days; confirm with
counsel"), seal/branding. Turns provisioning from a console form into a
20-minute conversation. Stands on: provisionAgency, statute profiles.

## Non-agent functionality worth roadmapping

- **Milestone notifications**: plain-language email on status changes
  ("your records are being reviewed — here's what that means"). Mechanical
  and factual, but it IS requester-facing — ship as per-agency policy,
  default Tier-2 hold, template-only (no free generation).
- **iCal deadline feed** per coordinator (statutory + internal due dates).
  Fully self-contained; no accounts anywhere.
- **Public transparency page** per agency: auto-published on-time rate,
  volume, median days, deflection count — the §11 metrics already computed,
  rendered where residents can see them. Trust compounds deflection.
- **Requester status API + webhooks**: `GET /api/v1/{agency}/requests/{publicId}`
  and a subscriber webhook — the first brick of the §16.4 agent-to-agent
  surface, and useful to newsrooms today.

## Suggested order when the time comes

A1 → A3 → A2 → A4 (each one session, immediate value), then B1 and B3 first
among the agents — B1 compounds the ROI loop, B3 cashes in the audit log —
with B4 as the differentiator bet. B5–B8 as demand appears.
