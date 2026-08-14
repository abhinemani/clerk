# The big-ticket board — what would make Brandeis special

Started 2026-08-14 at the owner's ask. This is NOT the near-term build
queue — that lives in HANDOFF's "Build candidates" and stays authoritative
for the next session's work. This is the ambition layer above it: the bets
that would make Brandeis a category of one rather than a better GovQA.
Rough sizing per item; nothing here is committed until it graduates into
HANDOFF as a build candidate.

The through-line: everything already built — append-only audit, statute
profiles as data, public-only retrieval, the learning loop, the agent
harness — was built as if these bets were coming. Most of them are one
layer of product on top of substrate that exists.

## 1. The network is the moat (cross-tenant compounding)

Every incumbent install is an island. Brandeis is multi-tenant with a
learning loop; the special version is letting tenants learn from EACH
OTHER, with consent and aggregation.

- **Cross-agency play network.** The learning loop (docs/learning-loop.md)
  builds plays per agency. Aggregate them — anonymized, opt-in, minimum-N
  thresholds — into a shared library: "building-permit requests route to
  Public Works and close in 6 median days across 40 CA agencies." A brand
  new tenant inherits the network's institutional memory on day one.
  Needs a new invariant (cross-tenant aggregation rules: no request text
  crosses, only distilled patterns above a population floor) before a line
  of code. Substrate: request_plays, the append-only record.
- **Exemption-practice benchmarking.** Same posture for exemption
  citations: "agencies in your state cite §6254(f) on 8% of police
  records; you cite it on 41%." Inconsistency across agencies is appellate
  ammunition — being the platform that KNOWS the norm is a counsel-level
  selling point. Substrate: the exemption logs finalizeRedaction writes,
  the annual-report dataset.
- **Compliance benchmarks on the transparency page.** The roadmapped
  public transparency page (agentic-horizon §non-agent) gets teeth when
  the numbers are comparative: "median 8 days — faster than 70% of
  comparable agencies." Trust compounds deflection; comparison compounds
  trust.

Why it's a moat: none of this is copyable by a competitor with separate
installs, and it gets better with every tenant. It is also the first item
on this board that needs genuinely NEW invariant thinking — treat the
aggregation-floor rules with the same seriousness as invariant 2.

## 2. Both sides of the machine-filed future (§16.4, cashed in)

The strategic-horizon bet says machine-to-machine requests are coming.
The status API + webhooks (shipped 2026-08-13) is brick one. Be the first
platform standing on BOTH sides of that future:

- **Requester API + MCP server. ✅ v1 SHIPPED 2026-08-14
  (docs/requester-api.md):** archive search, record reads, status, and
  gated filing over REST + a stateless MCP endpoint per agency — the safe
  surface exactly as argued below. Remaining from this bet: the
  cross-tenant requester identity + newsroom workspace (next paragraph).
  Original case: file, track, and receive over a public
  API — and expose it as an MCP server so a journalist's (or resident's)
  agent can do the whole loop conversationally. "FOIA over MCP" is a
  headline nobody else can write today, and the portal requester agent
  already defines the safe surface: same public-only retrieval (invariant
  3), same immutable-input rules (invariant 6), rate-limited, no auth
  escalation. The API is a projection of what the portal already allows —
  no new disclosure surface.
- **Requester identity across tenants + the newsroom workspace.** One
  account, every Brandeis agency: file with three cities, track in one
  place, saved topics, alerts when matching records publish anywhere on
  the network. Requesters become a constituency that ASKS their agency to
  adopt Brandeis — the two-sided growth engine.
- **B7 surge watchdog as the defensive counterpart.** If machine filing
  arrives, bulk detection and lawful consolidation (cite-or-silent) is
  what keeps staff standing. Already spec'd; belongs to this bet.

## 3. Fulfillment that reaches where records live

The fulfillment agent (HANDOFF candidate #1) plans scope decomposition
over what's IN Brandeis. The special version searches where records
actually live:

- **Custodial connectors.** Read-only adapters into the agency's own
  systems — mail archive (IMAP/Graph), SharePoint/Drive, the document
  management system — so the fulfillment agent can PROPOSE a responsive
  set from the source instead of waiting for a responder to remember.
  This is connected-sources turned inward: same adapter discipline
  (env-gated, degrades gracefully, secrets are env names), same reviewed
  mode (everything lands internal-only; a named human decides), invariant
  9 untouched. Staff attach-from-source replaces "please go search your
  email and upload what you find" — which is where most real-world FOIA
  time actually goes.
- **B5 records-inventory interviewer** is the map this stands on: the
  agent that learns which systems hold what, per department, through the
  email loop that already ships. Sequence B5 before custodial connectors.

This is the biggest lift on the board and the biggest claim: "Brandeis
finds the records." It should not start until the fulfillment agent v1
(planner over in-Brandeis scope) has proven the checkpoint UX under real
load.

## 4. Redaction as a category win

- **Audio/video redaction.** Bodycam, dashcam, 911 audio — the single
  most painful, most expensive record type in local government, and the
  tooling market is thin and dreadful. Face/plate blur and voice masking
  as proposals on a frame/segment timeline, human-verified before export,
  riding the existing redaction-studio grammar (suggest → review →
  finalize → burn). Heavy compute goes behind an adapter (local
  ffmpeg/model by default, env-gated GPU service optional — self-contained
  first, as ever). True redaction (invariant 1) extends naturally: export
  re-encodes, never overlays. A city that buys nothing else will buy this.
- **Redact-everywhere memory.** B2 (consistency auditor) is
  retrospective; run it forward: once a name/address is redacted under an
  exemption on this request, propose the same treatment across the rest
  of the review set — and surface prior treatment when the same string
  appears in FUTURE requests. Same defensibility theme, now preventing
  the inconsistency instead of reporting it. Substrate: exemption logs +
  the redaction studio's suggestion pipeline.

## 5. Trust you can verify

- **Public release-verification log. ✅ v1 SHIPPED 2026-08-14
  (docs/release-verification.md):** /{slug}/authenticity — browser-side
  hashing, public register, sha256 on the status API. The CT-style
  external append-only log remains future work, as the doc records.
  Original case: releases are already checksummed
  (invariant 8) and appeal packets already carry sha-256. Publish those
  hashes to a public, append-only per-agency transparency log with a
  verify page: anyone — a court, a newsroom, a skeptic — can confirm the
  document in hand is byte-identical to what the agency released, and
  that the log itself hasn't been rewritten. Small build (the hashes
  exist; this is a projection + a page), unique posture: evidence-grade
  public records. Pairs with the appeal-packet story: the packet cites
  the log.
- **Requester-visible process honesty.** Milestone notifications
  (roadmapped) plus a tracker that shows the deadline MATH — the statute,
  the day count, the extension basis — not just a status word. Invariant
  7 already computes and logs all of it; showing the work is what makes
  an agency look trustworthy instead of merely compliant.

## 6. The transparency autopilot (the north-star metric)

**✅ v1 SHIPPED 2026-08-14 (docs/transparency-impact.md):** the reports
page carries the north-star chart (requests vs. deflections, publications
annotated) and quantified publish-next recommendations with their
arithmetic printed. Remaining from this bet: the public-page version and
requests-per-resident normalization. Original case:

The homepage already promises "Fewer requests." Make that the measured
product, not a tagline:

- Converge B1 (demand patterns), connected-source standing publication,
  and the deflection log into ONE staff surface: what demand exists →
  what's published → what it deflected → what to publish next, with a
  quantified recommendation ("publishing the permit ledger would have
  answered ~60% of last quarter's permit requests — 34 hours of staff
  time"). Every number already excludes archive_miss from ROI (house
  rule); the projection math is new but pure-function territory.
- The north-star chart on the command center: requests per resident,
  trending DOWN, with publications annotated. No competitor wants request
  volume to fall; Brandeis's whole architecture does. Owning that metric
  publicly — on the transparency page too — is the identity move.

## 7. The statute layer as public infrastructure

- **All-50-states profiles, counsel-verified.** Statute logic is data +
  pure functions by design; the moat version is coverage plus a
  verification workflow (the counsel-review recency machinery from
  2026-08-13 generalizes: each profile carries who verified it and when).
  B4's third-party notice rules are the first schema expansion; response
  windows, appeal deadlines, and fee prohibitions (display-only — fees
  stay removed) follow the same data-not-code path.
- **"Know your rights" per state, requester-facing.** The portal explains
  the requester's actual statutory position — deadline, appeal path,
  what an agency may and may not ask — from the same profile data.
  Nobody does this because nobody else made statutes data.

## The opinionated shortlist

If the owner asked "pick three":

1. **Requester API + MCP server (§2).** Best timing-to-effort ratio on
   the board: the safe surface exists (portal agent + status API), the
   moment is now, and it's a story only Brandeis can tell.
2. **The network plays (§1).** Slowest to mature, impossible to copy,
   and every quarter of tenant history makes it stronger — which is the
   argument for starting the invariant/consent design early, before the
   data exists to be tempted about.
3. **Audio/video redaction (§4).** The category win. It's the one item
   here a city would buy standalone, and it wedges Brandeis into police
   records — the biggest, most litigated, most budgeted corner of the
   records world.

With the standing caveat that HANDOFF candidate #1 (the fulfillment
agent) still goes first regardless — it's what makes every agent claim on
this board credible, and its checkpoint UX is already built and waiting.

## Guardrails that travel with all of it

Nothing on this board relaxes anything: agents propose and named humans
publish (invariant 9) even at network scale; cross-tenant aggregation
gets its own invariant BEFORE its first migration; every external system
stays behind an env-gated adapter with a self-contained default; and any
requester-facing surface keeps the public-only retrieval guarantee
(invariant 3) as its outer wall.
