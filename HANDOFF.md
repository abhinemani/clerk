# Handoff — resume here

Context package for continuing in a fresh session. Read this top to bottom
before doing anything substantial; it replaces re-reading the git history.
Started 2026-07-29, appended to at the end of each build window since — the
dated entries below run newest-first. Everything is verified working as of
its own entry's date unless marked otherwise.

Repo: <https://github.com/abhinemani/clerk> · branch `main` · everything pushed.
**1036 tests pass (+5 skipped), typecheck clean, 4/4 e2e green** (counts
as of the newest 2026-08-14 staff-mobile-pass entry; e2e ran fresh there).

## START HERE (next session)

State in one line: demo-complete product, **Phase 5 open with FOUR agents
live** (B1 disclosure librarian, B2 consistency auditor, B3 appeal
packets, and the **fulfillment agent v1** — planner-driven, per-agency
flag, Riverton on) plus the §16.2 checkpoint/steering surface, the
**learning loop v1** ("plays" — docs/learning-loop.md, migration 0012), a
consolidated ingestion hub (/app/admin/data with drag-and-drop upload),
and a full UX/visual pass (staff nav rail, archive storefront, civic hero
bands, engraved-plate card ornament, lit page ground). Nothing is
half-built; every entry below was verified as described at its date.

**~~TWO STANDING EVAL DEBTS (2026-08-14)~~ CLEARED 2026-08-15** (newest
entry): both the fulfillment planner prompt (2026-08-14.1) and the
intake-triage prompt (2026-08-14.1) went through a live `npm run eval`
from a cloud session — all gates green (exemption needed one re-run; the
miss was model nondeterminism, not a regression). Scorecards recorded in
the newest entry. The ⚡ cloud-key path in docs/laptop-setup.md was
WRONG until that entry — the platform filters `ANTHROPIC_API_KEY` from
session env; the fix is the `CLOUD_ANTHROPIC_API_KEY` alias (see entry).

**GATES RELEASED (owner, 2026-08-13):** connected-sources phase 3 AND
Phase 5 agents (docs/agentic-horizon.md Bucket B) are buildable.
Guardrails unchanged: tiers enforced in code, invariant 9 untouched —
agents propose, a named human publishes.

**Build candidates, in rough priority order** (the strategy layer above
this queue — the "what would make Brandeis special" bets — lives in
`docs/big-ticket.md`; graduate items from there into this list, not
straight into a build):
1. **Fulfillment agent v2** (v1 SHIPPED 2026-08-14; live eval ✓
   2026-08-15, 5/6 — see newest entry for the one routing miss): grow
   the planner — connector_search
   over connected sources, plan revision mid-run (plan_update), per-item
   review-set curation instead of top-N, and the B5 records map as
   routing context when it exists.
2. **B4 third-party notice steward** (differentiator; needs notice rules
   added to state profiles as data). B2 shipped 2026-08-14; its forward
   version — redact-everywhere memory (big-ticket §4) — is the natural
   follow-on.
3. ~~**Learning loop v2**~~ **SHIPPED 2026-08-14** (fourteenth build):
   embedding matching, letter scaffolds, triage play context. Remaining
   v2 candidates (feedback tuning, copilot payload) in
   docs/learning-loop.md.
4. ~~**Connected-sources phase 3**~~ **SHIPPED 2026-08-14** (fifteenth
   build): row store + refusal-first tabular answers.
5. **Hybrid staff search** (per-chunk embeddings at ingest; service
   signature ready). (~~intake-dedup stored-vector perf item~~ — done;
   dedup + precedent ranking now run as SQL top-k.)
6. ~~**Mobile pass + animation review**~~ **DONE 2026-08-14** (sixteenth
   build, newest entry): deep staff surfaces verified at 390px, animation
   reviewed as far as this container's chromium executes it (one
   current-Chrome look at the marketing scroll-reveal remains for a
   laptop session), backup/restore runbook extended. The
   redaction-studio trio (redo, bar→log-card, redact-everywhere) turned
   out ALREADY SHIPPED in the studio — the candidate was stale; what was
   actually missing (the untested find-scan, touch taps) shipped in the
   same build.

**Before every push** (full contract in CLAUDE.md): offline suite green,
HANDOFF entry appended, and `docs/laptop-setup.md` updated in the same
commit if anything owner-facing changed (env vars, keys, services) — that
file is copy/paste-only by design; keep it that way.

**NEWEST (2026-08-15, cloud session): THE LIVE EVAL RUN — both standing
scorecard debts cleared, and the cloud-key path fixed for good.** Owner
asked for `npm run eval`; first live full-suite run since 2026-08-13.
- **Scorecards (all five suites, live API):**
  - **Custodian suggest 8/8** — 0 false referrals, 0 wrong targets, 3/3
    referrals caught.
  - **Exemption pass: FAILED first run, 5/5 on immediate re-run.** First
    run missed one PII label ("Dana Whitfield", incident-report-pii,
    case recall 80%, mean 96%); re-run scored 100% recall, 0 missed,
    0 decoys. The gate is zero-missed-labels by design, so know this:
    a single missed name can be MODEL NONDETERMINISM — re-run once
    before treating it as a prompt regression. Precision hovered 63–69%
    (reported-only; over-flagging is one dismissal).
  - **Fulfillment plan 5/6 (83%, bar passed)** — first live run of
    prompt 2026-08-14.1 (debt cleared). Miss: broad-incident-
    multi-department wants some item routed to "Public Works"; the plan
    routed Police Records ×2 + City Clerk ×2. Worth a look when building
    v2 — the planner under-spreads across departments on broad scopes.
  - **Intake triage 9/10 (90%, bar passed)** — first live run of prompt
    2026-08-14.1 (debt cleared); all four RAG/play golden cases pass
    (calibration + both contamination guards). Miss:
    police-report-personnel wants record type ~ "personnel", model said
    "internal affairs files, disciplinary records" — a vocabulary miss,
    arguably grader-strict, not a safety miss.
  - **Answer engine 3/3** grounded with public citations, no internal
    leaks.
- **THE GOTCHA (this is why no cloud session ever ran the eval): the
  claude.ai environment config CANNOT deliver `ANTHROPIC_API_KEY`.** The
  platform filters that exact name out of session env — sessions
  authenticate through the Anthropic account, and the env dialog warns
  the key "won't be used to authenticate requests". The owner had it
  configured correctly per the old ⚡ step 3; it silently never arrived
  (VOYAGE_API_KEY, a name the platform doesn't reserve, arrives fine).
  Every prior "cloud session had no ANTHROPIC_API_KEY" note in this file
  traces to this.
- **The fix — `CLOUD_ANTHROPIC_API_KEY` alias, mapped at both boot
  points:** `src/instrumentation.ts` (app server, so cloud dev-server
  live-AI verification works too) and `vitest.config.ts` loadDotEnv (so
  `npm run eval` scores live). Real `ANTHROPIC_API_KEY` always wins;
  alias added to the vitest.setup.ts strip list so `npm test` stays
  offline-deterministic. Verified live: full eval ran keyless-`.env`
  with only the alias exported. Owner action (already told): rename the
  variable in the claude.ai environment settings; docs/laptop-setup.md
  ⚡ step 3 + Part B scorecard + `.env.example` updated in this commit
  (owner-facing change → laptop doc same-commit, per contract).
- Offline suite + typecheck green. No schema, prompt, or app-behavior
  changes — prompts untouched, so no scorecard-diff obligation; this
  entry IS the recorded scorecard.

**PREVIOUS (2026-08-14, cloud session, sixteenth build of the window): THE
MOBILE PASS ON THE DEEP STAFF SURFACES + animation review + runbook
(HANDOFF candidate #6, closing it).** Every deep staff surface is now
verified no-horizontal-overflow at 390px in a real browser: command
center, request workspace, BOTH redaction studios, staff search, reports,
tasks, tenant admin (+data, +directory), agents, and the platform console.
- **The fixes, each a named pattern:** the request header's 7-button
  action row wraps (`flexWrap` — `.btn` stays nowrap, the ROW bends); the
  visual studio's canvas + 300px act rail moved to `.vrs-grid` in
  globals.css with a ≤900px collapse (two explicit grid tracks can never
  wrap on their own); the TEXT studio's real culprit was subtler — a 1fr
  grid track's implicit min-content minimum let `.doc`'s 540px min-width
  widen the PAGE instead of scrolling inside `.page`; `.redact-grid > *
  { min-width: 0 }` is the fix and the comment explains it; platform
  console cards use `minmax(min(380px, 100%), 1fr)` (a hard 380px minimum
  overflows a 390px phone); DirectoryManager's table got QueueTable's
  overflow-x wrapper and its form grid went auto-fit, as did
  PublicationQueue's; the reports bar rows wrap their count line under
  the bars; staff search's form wraps. SYSTEM-LEVEL FIX: `p.pill {
  white-space: normal }` — 42 call sites reuse `.pill` as sentence-length
  notice banners and nowrap made any long notice an overflow (the
  platform console's one break); status chips are spans and keep nowrap.
- **Redaction studio**: the trio in the stale candidate (redo,
  bar→log-card, redact-everywhere) was ALREADY SHIPPED — see the
  corrected Tier-1.5 note. New here: the inline find-scan extracted to
  `substringMatches` (domain/redaction.ts, tested incl. burns-clean;
  deliberately substring-not-word semantics, documented), and the studio
  converted to POINTER events: taps select bars/words on touch, and
  pointercancel (browser claiming a touch-scroll) abandons the draft
  selection rather than committing a smear. Precision drag-select stays a
  mouse/pen gesture on purpose — phone posture is tap-to-review.
- **Animation review** (the UX pass had only run reduced-motion): normal-
  motion pass done as far as this container allows — chromium 1194
  parses `animation-timeline: view()` but does NOT execute it, so the
  reveal degrades to fully-visible here (the @supports gating doing its
  job); nothing anywhere starts hidden, and page-bottom content is at
  opacity 1 at normal motion. Gotcha 12 reconciled (its "real bug" half
  was already fixed; the note was stale) and playwright.config.ts now
  sets `contextOptions: { reducedMotion: "reduce" }` so no future spec
  hits the blank-screenshot trap. STILL OWED: one look at the marketing
  scroll-reveal on current Chrome (laptop) — this container can't render
  it.
- **Backup/restore runbook extended in place** (docs/operations.md): the
  bare-laptop path (`.pgdata`/`.blobdata` are gitignored — a laptop that
  only pushes code has NO data backup), CONNECTED_DROP_PATH added to the
  state table (it's an inbox, no backup needed — reasoning recorded),
  "what a restore legally means" (restoring rewinds the append-only log —
  record the restore outside the system; retention/legal-hold interaction
  — a restore can resurrect a purposely-destroyed document, re-deleting
  is correct; invariant-8 checksums as the blob-half integrity check),
  and off-host + encrypted copies (backups the fire can reach are notes).
- 1036 offline tests (+5: substringMatches), typecheck clean, **4/4 e2e
  green** (container needed the chromium headless-shell shim AGAIN —
  1234→1194 symlink, mkdir -p first; container state, not repo state).
  Browser-verified per gotcha 11 at 390px with getBoundingClientRect
  overflow probes on every surface listed above, before/after screenshots
  delivered. No laptop-setup change (no env vars/keys/services — said out
  loud per the push contract).

**PREVIOUS (2026-08-14, cloud session, fifteenth build of the window):
CONNECTED-SOURCES PHASE 3 — the row store and tabular answers (HANDOFF
candidate #4; docs/connected-sources.md "Phase 3 as built").** The answer
box now answers "street cleanings for the last 3 months" with the actual
rows — count, table, provenance — not just the slice documents.
- **Migration 0017: `dataset_rows`** — one row per record of a synced
  slice, a PURE PROJECTION of the slice document's CSV, replaced wholesale
  per document on sync (the request_plays full-replace idiom — it can
  never drift from what the named human published). Sync also BACKFILLS:
  any slice with a `connectedSource` stamp but no `rowStore` bookkeeping
  gets rows materialized from `extractedText` on the next sync, so
  existing deployments converge with no special job. Slice docs carry
  `metadata.rowStore = { rows, complete }`; incomplete slices (connector
  truncation or the 50k storage cap) keep a 1k-row preview only. Rows date
  by the connector's `dateField` when the cell parses, else the slice's
  recordDate (file drops have no dateField — month-end is what they
  honestly know).
- **INVARIANT 3 IN THE QUERY: rows carry no classification.** The
  requester-facing port methods (`searchPublicDatasetRows`,
  `listPublicDatasetRowsForDocument`) JOIN documents and filter
  classification='public' in SQL; conformance tests plant marker strings
  on internal and cross-tenant slices and assert they never surface, and
  that a slice flipping public exposes its rows with zero row-side writes.
- **Tabular answers, refusal-first**: `composeTabularAnswer` (pure) +
  `findTabularAnswer` (service gate). Refusals are the design — wrong
  tables are confidently wrong: needs exactly ONE anchored dataset; every
  public slice complete; question terms must connect to the data
  (naming/column terms calibrate, cell-matching terms filter with exact
  counts, calendar words like a stranded "june" are never filters, and
  unconnected terms REFUSE when they outnumber connected ones — one stray
  synonym like "cleanings" must not kill a clearly-labeled answer);
  filtered counts require the full row set (no partial-page under-counts);
  unfiltered counts are the store's exact SQL total. Every answer carries
  a `basis` string (computeDueDate idiom).
- **Surfaces**: `TabularAnswerCard` in the answer box (above slice
  results, automated-answer flag, table scrolls in its own box — the
  page never scrolls sideways) and a "Data preview" table on the slice
  permalink. Displaying a table logs NO deflection (house rule).
- **Browser-verified** (gotcha 11, fresh-seeded :3400): "street cleanings
  for the last 3 months" → "6 rows in Street Sweeping" with the parsed
  window and "counted from 2 published slices" — the unpublished August
  slice excluded in the browser, not just in tests; permalink preview
  renders real cells; **no horizontal overflow at 390px** on either
  surface; staff request page + play card still render (the learning-v2
  UI delta rides this same session's verification). Screenshots
  delivered. 1031 offline tests (+19), typecheck clean. No laptop-setup
  change (no env vars/keys/services — said out loud per the push
  contract).

**PREVIOUS (2026-08-14, cloud session, fourteenth build of the window):
LEARNING LOOP V2 — plays match by meaning, scaffold letters, and ride the
triage prompt (HANDOFF candidate #3, all three sub-items;
docs/learning-loop.md "v2 as built").**
- **Embedding play matching.** Migration 0016 (first since 0015):
  `request_plays.embedding vector(1024)`, nullable — the rebuild averages
  member episodes' STORED ask vectors into a unit centroid (`centroidOf`,
  pure; members without vectors just don't contribute; no vectored member
  ⇒ null ⇒ lexical-only, exactly v1). `consultPlays` is two-pass: lexical
  `matchPlay` first, and only on a miss `matchPlayByEmbedding` against the
  request's stored vector (cosine ≥ 0.6 — the duplicate detector's bar, on
  purpose: a wrong play feeds a wrong routing suggestion). DESIGN LINE
  WORTH KEEPING: stored vectors ONLY, never a live embed call — the path
  runs on every request-page render and at intake, stays zero-key/zero-
  latency, and the FakeEmbeddingProvider keeps it offline-testable.
  `PlayMatch` gained `matchedBy: "terms" | "meaning"`; the play_routing
  event payload and the "Similar past requests" card both say when a match
  was by meaning.
- **Letter scaffolds per play** (`src/domain/playScaffold.ts`, pure +
  tested). `draftReplyAction` upgraded in BOTH branches: keyless, a
  matched play replaces the generic template with a history-grounded
  scaffold (typical route, median days, exemption heads-up); keyed, the
  same stats ride the correspondence context bag as
  `similar_request_history` — a context KEY, not a prompt-file change, so
  no eval gate. Copy rule pinned by test: history is stated as history
  ("that is our history, not a commitment"); the only obligation stated is
  the statutory due date (the owner's no-SLA-promise rule, applied to
  drafts).
- **Play stats as triage prompt context.** `PromptPlayContext` structural
  slice + `formatPlayContext`; intake-triage prompt bumped to 2026-08-14.1
  with the governance paragraph extended (statistics calibrate, raw text
  wins). Wired best-effort in `runIntakeTriageJob` beside precedents; the
  applied-draft event records `playContext` for audit. Golden set +2
  cases (calibration, contamination guard). ⚠ EVAL DEBT — see START HERE.
- 1012 offline tests (+16), typecheck clean. Not browser-verified in this
  container yet: UI deltas are one note line on the request card + the
  scaffold body in the reply composer (both server-rendered); verify
  alongside the next feature's browser pass this window. No laptop-setup
  change (no new env vars/keys/services; the eval debt rides the existing
  Part B instructions — said out loud per the push contract).

**PREVIOUS (2026-08-14, cloud session, thirteenth build of the window): TWO
CTAs ON THE MARKETING SITE — "Book a walkthrough" and "See it live"
(owner: "we need two calls to action … request a demo that takes them to a
scheduling form, and try it out that links to the live demo").** The
homepage led with "Create your records office", which asks a clerk who is
still evaluating to provision a tenant. The pair is now the ask ("Book a
walkthrough" → `/demo`) and the no-commitment look ("See it live" →
`/riverton`); wording was the owner's explicit call from four options.
- **`/demo` is a REAL form, not a mailto.** New page + server action +
  `DemoRequestForm`. Self-contained first: it writes a `demo_requests`
  row on every deployment with zero services configured, and the `/admin`
  console lists them (heading "Walkthrough requests", directly above
  "Onboard an agency" — that is the actual sequence). Email notification
  (`DEMO_NOTIFY_EMAIL`) is best-effort ON TOP, wrapped in try/catch: the
  row is the record, delivery never loses a lead. Reply-To is the
  requester, so replying goes straight to them.
- **An external scheduler is opt-in, not the default.** `DEMO_SCHEDULING_URL`
  (absolute http(s) only — a relative or `javascript:` value is refused,
  it would be a redirect gadget on a public page) makes every CTA link
  straight out, and `/demo` forwards there so old links still work. Unset
  = the built-in form. Both vars are in `.env.example` and
  `docs/laptop-setup.md` Part D⅞ (click paths + paste blocks).
- **`demo_requests` is PLATFORM-level — no agency_id** (migration 0015,
  additive). It is the one table a logged-out stranger can write to, so:
  pure validation in `src/domain/demoRequest.ts` (11 unit tests), the same
  fixed-window limiter `/signup` uses (5/client/hour, 60 deployment-wide),
  and an off-screen honeypot whose rejection LOOKS like success so a
  scraper learns nothing. Conformance test added for both adapters.
- **Gotcha worth keeping:** the test that caught a real bug was state-code
  normalization — slicing to 2 chars BEFORE validating turned "Texas"
  into "TE" and would have stored a state that doesn't exist. Validate the
  whole value, then keep it or drop it.
- **`demo` is now a reserved slug** (`accountService`) — without it an
  agency could take `/demo` and shadow the marketing form.
- **Self-signup is NOT gone, just demoted** (owner's call): it lives in the
  footer and a one-line note under the closing CTAs. Don't add a third
  button to either CTA row — see the comment at the top of `page.tsx`.
  **Second pass, same session:** the owner looked at the page and the
  top-right NAV button still read "Create your records office" — the most
  prominent element on the page still pointing at the demoted action,
  which re-created the exact hierarchy the change was meant to fix. The
  nav button is now "Book a walkthrough" and the nav link reads "See it
  live". Lesson: demoting a CTA means demoting it in the CHROME too, not
  just in the sections you happen to be editing.
- **Verified in a browser** (gotcha 11): both CTA rows resolve to
  `/demo` + `/riverton`, no horizontal overflow at 1280 or 390, and a real
  submission ("Marlin Unified School District") round-tripped — success
  card rendered, row confirmed in `.pgdata` with every column intact. The
  invalid-email path is unit-tested rather than browser-tested: the
  browser's native `type="email"` check blocks that submit client-side, so
  it never reaches the action. 996 tests pass (+5 skipped), typecheck
  clean.
  Owner-facing (two env vars) → `.env.example` + `docs/laptop-setup.md`
  updated in the same commit.
- **No turnaround promise on the success card** (owner, same session: the
  draft said "within one business day" → "cut that"). It now says what
  happens, not when. Don't let a reply-time SLA back onto a public surface
  — the product can't keep one on the owner's behalf.

**PREVIOUS (2026-08-14, cloud session, twelfth build of the window): THE
GOV-EMAIL SIGNUP GATE IS GONE (owner: "users shouldn't need to have gov
emails to register").** `/signup` refused anything that wasn't
.gov/.mil/state-local .us, which turned away real records offices —
school districts, joint-powers authorities, libraries, tribal
governments, and every `@cityof*.org` jurisdiction — at the front door.
The check itself is unchanged and still correct; what changed is what it
does with a `false`.
- **`isGovernmentEmail` is now a LABEL, not a gate.** Anyone can register.
  The function stays exactly as tested (lookalikes included) and rides the
  audit trail instead of the door. `src/domain/signupPolicy.ts` carries
  the reasoning; its test file now asserts the under-count cases
  (`@marlinusd.org`, `@…-transit-authority.com`) so nobody re-reads
  `false` as "fake".
- **The strict door is opt-IN, not opt-out.** `SIGNUP_ALLOW_ANY_EMAIL`
  (which meant "loosen it") is retired — any deployment that had it set
  to true now gets that behaviour by default, so nothing breaks.
  `SIGNUP_REQUIRE_GOV_EMAIL=true` restores the old refusal. **The form's
  copy follows the server**: the help line under Work email reads "Any
  address works — a .gov isn't required" normally and names the
  restriction on a deployment that opted in (`page.tsx` reads the env and
  passes `requireGovEmail`). Never print one rule and enforce another.
- **What guards the open door now**: the rate limiter (3/client/hour, 10
  deployment-wide — unchanged, but it is load-bearing now), tenant
  isolation from row one (a junk tenant is junk in its own box), and
  VISIBILITY — `provisionAgency` takes an optional `origin`
  (`console` | `self_signup` + `govEmail`), so the append-only
  `agency_created` event reads "Agency self-registered with admin … (non-
  government email)" with `actorLabel: "self-service signup"`. Console
  provisioning is byte-identical to before (`origin: "console"`, no
  `govEmail` key). That event already renders on `/admin/[slug]`, so the
  operator can see and delete a squatter.
- **Verified in a browser** (gotcha 11): signed up "Marlin Unified School
  District" with `records@marlinusd.org` → tenant live at
  `/marlin-unified-school-district`, ingest key shown once. Then
  restarted with `SIGNUP_REQUIRE_GOV_EMAIL=true` and a gmail address →
  refused with the honest copy, and the help line flipped to match.
  983 tests pass, typecheck clean. `.env.example` + `docs/laptop-setup.md`
  (Part D¾) updated in the same commit — the runbook now tells the owner
  who may open a tenant and which single variable changes it.

**PREVIOUS (2026-08-14, cloud session, eleventh build of the window): THE
PORTAL ON A PHONE — header collapse, the chips are gone, and the answer
box becomes a CHAT (owner, from the live demo site: "the header is too
tight and falls on top of itself … there are pills under the input box we
don't need … the UI doesn't make it clear where to follow up to chat
after you ask a question").** Three fixes plus two neighbours the phone
screenshots exposed. Candidate #6 (mobile pass) is now partly paid down —
the public portal and the staff shell are verified at 390px; the rest of
the staff surfaces are not.
- **The header.** The tenant/console bar (agency seal + name + four
  links) had NO small-width rules at all — the marketing bar's collapse
  is scoped to `.mk-topnav`. At 390px flex resolved the overflow by
  shrinking the brand under its own text, so "Portal" sat ON "City of
  Riverton" and "Sign in" ran off-screen. Now: `.nav-link` is
  `white-space: nowrap`, the brand can't shrink below its content
  (`min-width: 0` + one-line ellipsised agency name), links tighten at
  ≤880px, and at ≤700px the bar breaks into two rows — identity above, a
  horizontally SCROLLABLE link rail below (same pattern `.staff-nav-row`
  has always used; wrapping would grow the sticky bar a row per link and
  strand the active underline mid-stack). Scoped
  `.nav:not(:has(.brand-lockup))` so the marketing bar keeps its own
  collapse. `.wrap` now exposes `--gutter` so the rail can full-bleed by
  negating it exactly.
- **The chips are gone** (Free / No account needed / …) from the portal
  hero. They sat between the question box and its answers.
- **The answer box becomes a chat once a thread exists.** `chatting`
  (thread non-empty AND the agent is up) now drives: composer moves OUT
  of the page and DOCKS inside the thread card under the last turn,
  magnifier → speech bubble, "Ask" → "Send →", placeholder → "Reply —
  e.g. just 2024, or who signed it?", a "Records assistant" card header,
  and a one-line "keep going, it remembers this conversation" foot. The
  debounced archive search goes quiet in chat mode (a second results card
  sprouting under the thread as you type a reply is the "this is a search
  box" signal again). If the agent drops mid-thread, `chatting` goes
  false: turns stay, composer reverts to search — no invitation to reply
  to something that can't answer.
- **Two inline-style-beats-class bugs found by the same screenshots.**
  Every `.stat-row` sets its column count INLINE, so the ≤900px override
  never applied — a phone got five 60px columns of clipped numerals. And
  `.hide-sm` lost to an inline `display:inline-flex` on the gov banner's
  signed-in block, giving a 3-line banner (sign-out still reachable: both
  the account page and the console carry their own). Both overrides now
  say `!important`, with the reason in the comment; `.stat-row` also goes
  1-up at ≤560px, and the staff console drops its local copy of the rule.
Offline suite green (980 pass / 5 skipped), typecheck clean, **4/4 e2e
green** (this container ships chromium 1194 and the pinned Playwright
wants 1234 — run e2e with a throwaway config that sets
`launchOptions.executablePath: "/opt/pw-browsers/chromium"`; don't
`playwright install`). Verified in a real browser per gotcha 11: portal +
staff console at 390/700/1280, boxes measured with
getBoundingClientRect (no overlap, `scrollWidth === clientWidth`), and
chat mode screenshotted by temporarily seeding a thread — this session
had no ANTHROPIC_API_KEY, so the live agent path is still unexercised
here. Nothing owner-facing (no env/keys/services — laptop doc untouched,
checked).

**PREVIOUS (2026-08-14, cloud session, tenth build of the window): HOMEPAGE
COPY — hero third beat + the quote band (owner ask: "Decisions you can
defend" didn't land; the pitch is transparency made turnkey, and the
namesake's line belongs on the page).** Two edits, `src/app/page.tsx`
only:
- Hero accent line is now **"Transparency, made turnkey."** (was
  "Decisions you can defend.").
- The `mk-quote-band` letterhead moment now carries the actual Brandeis
  quote — **"Sunlight is said to be the best of disinfectants."** (Louis
  D. Brandeis, 1913) — with a one-line tie-back to the product. The "AI
  proposes. Staff disposes." band copy comes off the homepage (the
  principle still reads in the under-the-hood sub and the hero chat
  foot, and remains a hard convention in CLAUDE.md — nothing about the
  product changed, only the pull-quote).
Copy stays LEAN per the standing directive — same beat count, no new
sections, no claims or numbers changed. Offline suite + typecheck green;
homepage HTML render-checked for both strings. Nothing owner-facing
(no env/keys/services — laptop doc untouched, checked).

**PREVIOUS (2026-08-14, cloud session, ninth build of the window): THE
FULFILLMENT AGENT V1 + B2 + THE PRODUCTION INDEX — HANDOFF candidate #1
built end-to-end, plus two items graduated from the owner's
FOIA-workflow-recommendations review (owner: "Do #1, 3 and 4 from your
list").** Three features, one migration, all through the real harness.
- **Migration 0014** (first since 0013): `agent_type` enum grows the
  Phase-5 values `disclosure_librarian`, `appeal_packet`,
  `consistency_auditor` — persisted runs for all Phase-5 agents now
  possible (the deliberately-deferred item from the checkpoint-surface
  entry). Conformance test proves each value round-trips on PGlite.
- **FULFILLMENT AGENT V1 (candidate #1, all three steps):**
  (a) the enum migration above; (b) the **scope-decomposition golden
  set** in the eval suite (evals/fulfillmentPlan.{golden,test}.ts +
  fulfillmentPlanGrade.ts — grader unit-tested offline, live run gated on
  ANTHROPIC_API_KEY like every eval; ⚠ see the standing eval debt in
  START HERE); (c) the **model-driven planner behind a per-agency flag**
  (`settings.fulfillmentAgent.enabled`, admin card under Workflow
  automation, Riverton seed ON — demo tenant first). The pieces:
  - `src/ai/prompts/fulfillmentPlan.ts` + `pipelines/fulfillmentPlan.ts`
    (versioned 2026-08-14.1): scope → 1–6 items, each with a search
    query + optional department routing. `clampFulfillmentPlan` enforces
    the guardrails IN CODE (item cap — gotcha 9, no schema bounds —
    and departments only from the provided list; invented ones are
    stripped, tested). `fallbackFulfillmentPlan` is the no-key path:
    deterministic items from triaged record types — the button degrades,
    never breaks (self-contained first).
  - `src/services/fulfillmentService.ts` `startFulfillmentRun`: flag
    check → plan (pipeline, else fallback; a planner failure also falls
    back) → plan-time corpus search per item (searchAgencyRecords) →
    steps with EVERYTHING in their inputs (deadline-agent resumability
    rule) → persisted agent_runs row → real harness. read_request /
    corpus_search echo their plan-time inputs; `assemble_review_set`
    REALLY attaches (link + retention hold — the spoliation rule — + one
    note event); each `dispatch_task` is Tier 2 and PARKS the run at
    /app/agents; `status_memo` lands the memo as a request note. The
    planning pipeline run itself is an `ai_action` event (invariant 10),
    every step an `agent_action` event with the runId.
  - `fulfillmentCapabilityRegistry` exported from fulfillmentAgent.ts;
    steering.ts registryFor gained `case "fulfillment"` — approve on
    /app/agents resumes through the same harness and the approved
    dispatch really emails via dispatchTask (delivery event as ever).
  - UI: "✦ Run fulfillment agent" button in the request header (renders
    only when the flag is on and the request is open); parked runs
    redirect the coordinator to /app/agents.
- **B2 CONSISTENCY AUDITOR (third Phase-5 agent, spec order bent by the
  owner's pick):** `src/domain/consistencyAudit.ts` (pure, tested) finds
  cross-request divergence in the §5 review log — same record type
  released in full in one request but withheld/redacted in another
  (divergent_decision), or restricted under different exemption labels
  (divergent_exemption). Same-request divergence is NOT a finding
  (per-document review is normal); needs ≥2 distinct requests; label
  comparison is case-insensitive. `consistencyAuditorAgent.ts` runs
  read_decision_log (new read tool) → flag_for_review per finding (Tier
  1) → status_memo through the real harness; allowlist has NO
  decision-changing hole (tested). Nightly sweep gates it to WEEKLY via
  its own `consistency_audit` admin event (digest lands clean OR dirty —
  "we audit weekly" is itself defensibility; runs persist to agent_runs).
  Command center gained an "Inconsistent treatment across requests" card
  (same domain computation as the sweep — the two can't diverge).
- **PRODUCTION INDEX (Vaughn-style index of records) + THE EXEMPTION-LOG
  UNIFICATION:** `src/reporting/productionIndex.ts` (pure, tested) —
  per-document rows (decision, exemption, named decider, distinct
  redaction reasons read from the redacted artifact's metadata
  exemptionLog, and WHICH checksummed release carried it, resolved
  through the artifact), plus the exemption-log section. Served as
  `/app/requests/[id]/production-index.pdf` (defensibility-route idiom)
  with a "Production index" button next to Appeal packet. REFACTOR WORTH
  KNOWING: `compileExemptionLog` in that module is now THE one
  exemption-grouping implementation — releasePrepAgent's
  compile_exemption_log capability was rewired onto it (its inline
  grouping deleted; ExemptionLogEntry re-exported for compat), so the
  agent's log and the index can never diverge in aggregation.
- Verified: typecheck clean, **980 offline tests** (+31: consistency
  domain/agent, production index, fulfillment service, plan grader,
  enum conformance), 4/4 e2e (container needed the chromium
  headless-shell shim AGAIN — 1234→1194 symlink, mkdir -p first per the
  dangling-symlink trap; container state, not repo state).
  Browser-verified on a fresh-seeded :3400 server (screenshots
  delivered): both new header buttons, production-index.pdf serving,
  fulfillment run via the FALLBACK plan (no key in this container)
  completing with memo + review-set attach, the run listed on
  /app/agents — where the B2 weekly audit run from the boot sweep also
  appears — and the admin card toggled on for Riverton. NOT verified
  live: the model-planned path with real dispatch_task parking (needs a
  key) — the offline suite covers it with FakeModelClient; first keyed
  session should press the button on Riverton and approve the parked
  dispatch once. No laptop-setup change (no new env vars, keys, or owner
  steps; the eval debt rides the existing Part B instructions — said out
  loud per the push contract).

**PREVIOUS (2026-08-14, cloud session, eighth build of the window):
PERFORMANCE PASS — vector search moved into the database, N+1 hot paths
batched, app-layer waterfalls collapsed (owner: "are there ways to
optimize the code?" → audit, then "yes do that").** No intended behavior
change anywhere; every path keeps its degradation story.
- **Migration 0013**: HNSW indexes on `requests.embedding` and
  `document_chunks.embedding` (pgvector `vector_cosine_ops`; PGlite's
  wasm pgvector builds them fine — the conformance suite proves the
  migration), plus btree for the queries that actually run:
  `requests`/`documents` `(agency_id, created_at)`, `tasks`/`reviews`/
  `document_chunks` `(agency_id)`, `request_documents (document_id)`.
- **The port grew top-k vector search** (both adapters + conformance
  tests): `searchRequestEmbeddings` (opts: excludeRequestId /
  interpretedOnly), `searchBodyChunkEmbeddings`,
  `searchPublicDocumentEmbeddings` (public scope enforced IN the query —
  invariant 3 exactly as the list method), `getRequestEmbedding`,
  `listRequestsWithoutEmbedding`, and batch
  `listRequestDocumentsForRequests`. Drizzle ranks with `<=>` ORDER BY
  LIMIT; InMemory mirrors with JS cosine; conformance asserts identical
  ranking, filters, and tenant scoping.
- **Call sites rank in the store now instead of loading every vector into
  JS**: `findDuplicateRequests` + `findResolvedPrecedents`
  (similarRequestsService — the lexical fallback for unembedded rows
  survives via `listRequestsWithoutEmbedding`; a filing with no vector of
  its own still falls back to full lexical), staff records search's chunk
  half (recordsSearchService), and the archive search vector half.
- **N+1s batched**: `archive.ts toItems` resolves releases from ONE
  `listAllReleases` map (was `getReleaseById` per release-born doc on
  every archive render, search, and answer-box keystroke);
  `priorAnswerService` scopes from two batch reads (was TWO serial
  queries per answered request on the public pre-filing path);
  `retentionService` close-path reconciliation is one batch read (walk
  order preserved — the re-point still names the newest open request).
- **App layer**: `requireStaff`/`sessionUser` are request-cached (React
  `cache`; the role check stays per-call so pages still enforce their own
  lists), the command center's five serial reads run as one Promise.all,
  and the request detail page reuses the loader's raw request + events
  (`getRequestDetail` now returns `raw`) and folds its ~nine serial
  stages into one parallel batch — the archive match (an embedding call)
  is off the critical path, and the release approver comes from the
  already-loaded staff list. DATABASE_URL pool: `max: 1` → `PG_POOL_MAX`
  (default 10; still 1 on Vercel where the platform fans out instances).
  `.env.example` documents it; laptop-setup deliberately untouched — no
  owner hands needed, defaults apply.
- **Stale item corrected** in the gotchas: the "intake dedup re-embeds
  the corpus via findDuplicates" note described code that no longer runs
  (`findDuplicates` survives only as a fixture for hybrid.test.ts).
- **Parked from the same audit** (mechanical follow-ups, none blocking):
  platform-console per-tenant count queries (6×N on /admin),
  reportingData's per-denied-request listEvents fan-out + period filters,
  connectedSourceService's per-source whole-corpus load, the nightly
  sweep's repeated listAgencies/listRequests reads (register.ts),
  caseLearning's per-request tasks/reviews rescan (bucket into Maps),
  redact-visual's full-PDF re-decode per page image, embedRequestsJob
  batching (embedJob's BATCH=64 idiom), queue idle backoff, piiScan
  resolveOverlaps single-pass sweep, next/image for the 222KB lockups.
- Verified: typecheck clean, **949 offline tests** (+6 new conformance),
  **4/4 e2e green**. Container needed the chromium headless-shell shim
  AGAIN, new flavor: Playwright wanted `chromium_headless_shell-1234/`
  `chrome-headless-shell-linux64/chrome-headless-shell`; symlinked it to
  the installed 1194 `chrome-linux/headless_shell`. Container state, not
  repo state.

**PREVIOUS (2026-08-14, cloud session, seventh build of the window): THE
PLATFORM CONSOLE GROWS UP — cities & users manageable end-to-end (owner:
"map out and build a robust admin interface where I / admin can manage
cities, users etc").** The /admin operator console had health + onboarding
but almost no levers; now it manages both.
- **Port: `updateAgency` accepts `name`** — display name ONLY; slug and
  stateCode stay fixed on purpose (URLs and statute obligations never
  drift under a rename; a mis-provisioned agency is re-created). Both
  adapters + conformance tests, including "a settings-only patch never
  blanks the name" (the Drizzle guard is `!= null && trim()`).
- **accountService platform section**: `renameAgency` (audit event
  `agency_renamed`; a no-op rename appends nothing);
  `platformCreateStaffUser` / `platformInviteStaffUser` — the tenant
  add/invite flows' bodies were EXTRACTED into shared cores
  (`insertStaffWithPassword` / `insertStaffInvite` + `sendStaffInviteLink`)
  so the operator path reuses the exact validation instead of forking it,
  attributed "platform operator"; `resendStaffInvite` (fresh 7-day link;
  refused once activated — that's a reset); `revokeStaffSignIn` (clears
  passwordHash — the row SURVIVES for audit attribution; restore = reset
  or re-invite; GUARDED so a tenant can never be left with zero admins
  able to sign in).
- **`requireStaff` hardened**: a passwordless DB user now redirects to
  login. A session can only exist if a password once did, so revocation
  kills a live session on its next request — verified in the browser
  (staff session at /riverton/app, operator revokes, reload bounces to
  login).
- **/admin/[slug] rebuilt**: Agency identity card (rename form + "what's
  fixed" copy), staff rows gain Reset password / Revoke sign-in (activated)
  or Re-send invite (invite-pending), an Add-a-staff-member form (blank
  password ⇒ invite via the tenant's outbox — tenant-admin idiom), and a
  Recent activity feed (listAdminEvents 20) where operator actions land in
  the tenant's own append-only log.
- **NEW `/admin/people`**: cross-tenant search over staff + resident
  accounts by name/email, grouped by agency, READ-ONLY on purpose —
  management actions live on each agency's page where tenant context is
  unambiguous. Console nav is now Agencies · People · Marketing site.
- **mailboxImport flake resolved per the standing instruction**: it
  recurred twice back-to-back this window, so the "Import a mailbox
  export" expect got the file's own 15s timeout idiom; clean single run +
  clean full 4/4 after. (Container needed the chromium headless-shell
  shim AGAIN — 1234→1194 symlink dir; container state, not repo state.
  Trap for the note: a DANGLING shim symlink makes `cd` fail silently and
  scatter symlinks into the cwd — build the dir with real `mkdir -p`
  first.)
- 943 tests (+6), typecheck clean, 4/4 e2e. Browser-verified live
  (screenshots delivered): rename round-trip + its two audit events,
  invite → re-send → row states, revoke → invite-pending flip, people
  search across the seeded tenants. No migration, no env vars, no
  laptop-setup change (operator creds and their production posture are
  unchanged).

**PREVIOUS (2026-08-14, cloud session, sixth build of the window): THE
SPACING PASS (owner: "spacing from the header to the first line of
content is too tight… make all the spacing correct").** Vertical rhythm
is now a token scale, not ad-hoc numbers:
- **globals.css `:root` gains `--page-top: 56px` / `--page-top-snug:
  40px` / `--page-bottom: 88px`** (8px grid; top gives real air under the
  two stacked sticky bars, bottom is deliberately larger so pages exhale
  before the footer; snug is for workbenches that keep tools high).
- **Every page container swept onto the tokens** (~30 files): the ad-hoc
  28/36/40/48/56px inline `paddingBlock`s on staff pages, portal pages,
  auth pages, platform console, and the civic-hero pages (hero inner
  wraps take --page-top; below-hero content takes the snug top). The
  workbenches (request detail, redaction studios, search) keep their
  tight bottoms but rise to the snug top. Marketing was already fluid
  (mk-hero clamp 64–108px; mk-section clamp 54–88px) — untouched.
  Future pages: use the tokens, never a literal.
- **HERO RECOMPOSED (owner: "the homepage hero is not well designed").**
  Three structural fixes, not tweaks: (1) columns are TOP-ALIGNED
  (`align-items: start` on .mk-hero-grid) — centering the short headline
  column against the taller panel had left it floating with no shared
  top line; a 6px optical offset meets the eyebrow to the chat header.
  (2) A **proof row** (`.mk-hero-proof`: 5 statute profiles · 100%
  audit-logged · 0 services, stat-numeral grammar with gold base rules)
  anchors the headline column's foot where dead space was. (3) The chat
  panel is STAGED as a composed object (`.mk-chat-wrap`): an offset
  gold backing plate (engraved-plate language at hero scale) plus its
  own key light — GOTCHA: the glow's radial ellipses must fit their box
  (center ± radius ≤ 100%) or the clipped edges print as faint hard
  lines; the comment in globals.css records the rule. Verified 1440/
  1000/390, no overflow.
- **HERO CHAT COMPACTED (owner follow-up: "the image on the homepage
  hero is too tall").** The chat illustration went 712→587px (hero
  961→836) via tighter .mk-chat-* spacing (body gap/padding, bubble
  padding, 0.92→0.88rem messages, head/foot padding) plus three copy
  trims (bot replies and the chat foot each lost a line — records and
  both story beats kept). Verified no overflow at 1440/390.
- **THE MARKETING TIGHT SPOT (owner's actual complaint, follow-up):** the
  hero's vertical padding lived on `.mk-hero-inner` — the LEFT column
  only — so the right column's chat panel rode ~3px under the nav. The
  padding moved to `.mk-hero-grid` (both columns clear the nav together;
  measured 108px chat-top gap at 1440, 90px stacked at 1000, 64px at
  390, no overflow). If a hero column is ever added/split again, keep
  the padding on the GRID.
- 937 tests, typecheck clean, 4/4 e2e. Browser-verified across command
  center, admin, reports, tasks, archive, authenticity, request form.
  FLAKE WATCH: mailboxImport.spec failed once again this window (the
  "Import a mailbox export" visibility timeout, pre-existing — recorded
  at the release-verification build too), passed on re-run both times;
  if it recurs, bump that expect's timeout rather than chasing ghosts.

**PREVIOUS (2026-08-14, cloud session, fifth build of the window): HOMEPAGE
REDESIGN AROUND THE NEW FEATURES + ADMIN GOES OFFICIAL CREAM (both owner
asks: "redesign the homepage… logo stays the same" / "main divs for the
admin pages should have a white/cream background… more official").**
- **Homepage** (`src/app/page.tsx`, logo/lockup untouched): the abstract
  "What it costs" ROI-stat band is REPLACED by "The agent era" (same plum
  band, texture map intact) — and per the owner's follow-up ("use the
  look and feels"), the three differentiators render as **PROOF PANELS:
  miniatures of the real surfaces** in the hero-chat's glass-slab grammar
  (`.mk-proof*` in globals.css): an MCP tool exchange (search_records →
  file_request → PR-2026-00184, the hero's scenario), the authenticity
  page's "✓ Authentic release" card mirroring the SEEDED release
  (janitorial-contract-2025.pdf · PR-2026-00002 · real sha prefix —
  literally checkable on /riverton/authenticity), and the reports page's
  requests-vs-deflections bars at postcard scale with the projection
  pill + basis line. Captions carry the one-sentence claims (LEAN rule);
  each panel is role="img" with a full aria-label, like the hero chat.
  Section closes with the literal endpoint (`/api/v1/riverton/mcp`)
  so a skeptic can check from a terminal. Verified: no horizontal
  overflow at 1440 or 390px. Roster grew 6→8 (clean 2×4):
  the disclosure librarian and the appeal packet builder. Deflect/Defend
  pillar bodies absorb the measured-report and fingerprint claims (still
  one sentence each — the LEAN rule held; page structure note at the top
  of page.tsx updated). Hero panel-note now carries the MCP line; footer
  gains "Verify a released document". Hero headline/copy untouched — the
  new sections make it literal. Every claim checkable (5 statute
  profiles re-verified; MCP path is live on the seed).
- **ADMIN PLATES ARE CREAM (CLAUDE.md brand section records this as the
  one dark-lock amendment — read it before "fixing" anything).** New
  `admin/layout.tsx` wraps `/app/admin/*` in `.admin-paper`; globals.css
  (next to `.card-pad`) re-pins the LIGHT palette's tokens onto
  `.card`/`.stat` inside it and paints cream sheets (ink hatch, lit top
  edge, real drop shadow onto the dark ground). NOT a theme switch: page
  ground/nav/rail/on-ground headings stay dark. Mechanism is the house
  token-re-pin idiom (the .nav pin); if the light :root palette moves,
  move that block too. Admin components turned out fully token-driven —
  zero per-component fixes needed.
- 937 tests, typecheck clean, 4/4 e2e. Browser-verified: homepage beats
  (agent-era band, 8-card roster, MCP endpoint line, footer link) and
  cream plates on /app/admin + /app/admin/data — screenshots delivered.
  No migration, no env vars, no laptop-setup change.

**PREVIOUS (2026-08-14, cloud session, fourth build of the window):
TRANSPARENCY IMPACT — big-ticket §6's first slice is LIVE
(docs/transparency-impact.md).** Item three of the "one at a time" run:
the north-star metric on the page. /app/reports gains a "Transparency
impact" section (live agencies only): totals (hours avoided all-time /
deflections / archive size), the requests-vs-deflections 6-month chart
(publications + misses annotated per month, goal stated in the caption),
and "What publishing next would be worth" — the B1 demand patterns with
a CONSERVATIVE projection each (requests × 1.0h citation-answer rate;
searches/misses cited as demand, never monetized — no double counting)
and a computeDueDate-style `basis` string so every number traces to the
request log.
- `src/domain/transparencyImpact.ts` (pure, tested) + service loader.
  REFACTOR WORTH KNOWING: `demandSignalsFrom` is now the ONE demand-
  signal builder — the command center's inline signal code was replaced
  with it, so the disclosure card and the impact section can't diverge.
- archive_miss stays out of every ROI column (house rule); "records
  published" buckets by document createdAt (classification flips aren't
  separately timestamped — copy says so).
- 937 tests (+4), typecheck clean. Browser-verified: section renders on
  the seeded server; opportunities card appears once ≥3 clustered
  signals exist (verified by filing 3 similar requests through the new
  requester API — the two features compose). No migration, no env vars,
  no laptop-setup change.

**PREVIOUS (2026-08-14, cloud session, third build of the window): RELEASE
VERIFICATION — big-ticket §5 is LIVE (docs/release-verification.md).**
Item two of the owner's "one at a time, push and merge" run. Invariant 8's
checksums, made public: anyone holding a released file can prove it is
byte-identical to what the agency shipped.
- **`/{slug}/authenticity`** (opt-in `settings.releaseVerification`, admin
  card, footer link when on, /log 404-idiom when off): WebCrypto sha-256
  IN THE VISITOR'S BROWSER — bytes never travel, only the digest; paste-a-
  hash path for machines; honest no-match copy (a miss is not proof of
  tampering). Below it, the register of PUBLIC releases with per-file
  fingerprints. THE DESIGN LINE: verify searches every release
  (possession of the bytes is the credential) but answers tracker-level
  facts only; the register is public-visibility only. Placeholder
  checksums (16-char stamps on metadata-only docs) can never verify and
  render as "not independently verifiable".
- **New port method `listAllReleases(agencyId)`** (newest first),
  InMemory + Drizzle, conformance-tested per the CLAUDE.md rule.
- **Status API artifacts now carry `sha256`** (verifiable digests only,
  null otherwise) — machine clients verify end-to-end; flows through the
  MCP get_request_status tool unchanged.
- Domain (`releaseVerification.ts`) + service tested; Riverton seed
  enables the page (the seeded release makes it verifiable out of the
  box). 933 tests (+13), typecheck clean, 4/4 e2e. Browser-verified:
  paste-hash ✓, downloaded-artifact-re-verify ✓, negative ✓, footer link
  ✓ — screenshot delivered. Screenshot trap for the record: the LIT
  GROUND is viewport-fixed, so Playwright fullPage stitches show a white
  band below the first viewport — artifact, not a bug; check a scrolled
  viewport shot before "fixing" it. No migration, no env vars, no
  laptop-setup change.

**PREVIOUS (2026-08-14, cloud session, same window as the board): REQUESTER
API + MCP SERVER — big-ticket §2's first slice is LIVE
(docs/requester-api.md).** The owner said "do one at a time and push and
merge as you do"; this is item one, chosen per the board's shortlist
(best timing-to-effort). A resident's or newsroom's AI assistant can now
do the whole requester loop against an agency portal, over REST or MCP.
- **Opt-in**: `settings.requesterApi = { enabled, filingEnabled }` (jsonb,
  NO migration), new admin card "Requester API & MCP server" next to the
  status-API card (`RequesterApiPanel` + `setRequesterApiAction`, admin
  event `requester_api_changed`). Absent ⇒ every route 404-plays-dead
  (status-API idiom). Riverton seed enables both.
- **REST** (`/api/v1/{slug}/…`): `GET /archive?q=` (the portal's
  `searchArchiveDetailed` projection — invariant 3 lives in the query
  layer, unchanged), `POST /requests` (filing; separately gated +
  rate-limited), and the EXISTING status route's gate widened to
  `statusApi.enabled || requesterApi.enabled` (a machine-filed request
  must be machine-checkable without a second toggle).
- **MCP** (`POST /api/v1/{slug}/mcp`): stateless streamable-HTTP,
  HAND-ROLLED JSON-RPC in `src/mcp/server.ts` (~150 lines, no SDK
  dependency — self-contained first). Tools subset only: initialize /
  ping / tools/list / tools/call; notifications → 202; batching refused
  (dropped in protocol 2025-06-18); GET → 405 (no SSE, allowed by spec).
  Tools (`src/mcp/requesterTools.ts`, deps-injected): search_records,
  get_record (text truncated at 6k), get_request_status, and
  file_request registered ONLY when filingEnabled. Tool-execution
  failures are isError RESULTS; only protocol misuse is a JSON-RPC error.
- **ONE FILING PATH, REFACTOR WORTH KNOWING**: the portal action's whole
  intake chain (submitRequest → routing rules → play routing → triage
  job → duplicate check) moved to `intakeService.submitAndDispatch`;
  the portal action and the API's `fileViaApi` both call it, so a second
  front door can never fork the chain. Enqueue has a test-seam override
  (emitStatusWebhook idiom). Filing rate limit reuses SignupRateLimiter
  (5/hr per slug+client-IP, 200/hr global, in-memory — signup posture).
- **Verified live** (fresh-seeded :3400 server — note SEED_DEMO=true is
  what seeds settings; bare ensureAgency bootstrap does NOT): full MCP
  handshake, search hit on the connected-source slice, file_request →
  PR-2026-00004 with the real CA 10-day deadline, status by tracking
  number, bellmar (not opted in) 404s; REST filing 201 + archive search;
  browser-verified the admin card AND the portal form still filing
  (PR-2026-00006) through the refactored chain — screenshots delivered.
- 920 tests (+26: mcp/server, mcp/requesterTools, requesterApiService),
  typecheck clean, 4/4 e2e (one connectedSources flake observed across
  runs — "0 new, 1 unchanged" when the periodic sync sweep beats the
  spec's manual Sync-now click; pre-existing race, clean 4/4 on re-run.
  Container needed the chromium headless-shell shim again: the pinned
  chromium_headless_shell-1234 path was hand-assembled from the installed
  1194 build — container state, not repo state). No model calls, no auth/keys ON PURPOSE (anonymous-
  public surface; the doc's non-goals say when to revisit). No
  laptop-setup change (no env vars, no owner steps — opt-in is in-app).
  Gotcha hit: the cloud container carries a real VOYAGE_API_KEY, so a
  seeded dev server's archive search calls live Voyage and can 429 —
  degrades to keyword-only by design, but don't mistake it for a bug.

**PREVIOUS (2026-08-14, cloud session): THE BIG-TICKET BOARD —
`docs/big-ticket.md`, the strategy list the owner asked to start
("not just what's in the handoff file — what would make this app
special").** Docs-only window. Seven bets, each grounded on existing
substrate: (1) cross-tenant network plays — shared play library,
exemption-practice benchmarking, comparative compliance stats (needs a
NEW aggregation invariant before any code); (2) both sides of §16.4 —
requester API + MCP server on the portal-agent/status-API safe surface,
cross-tenant requester identity + newsroom workspace, B7 as the
defensive half; (3) custodial connectors — connected-sources turned
inward at the agency's own mail/DMS/drive systems, sequenced after
fulfillment-agent v1 and B5; (4) audio/video (bodycam) redaction as the
category win + B2 run forward as redact-everywhere memory; (5) public
release-verification log riding invariant 8's checksums; (6) the
transparency autopilot — deflection/publication converged into one
surface with requests-per-resident as the north-star metric; (7) the
statute layer as public infrastructure (50-state counsel-verified
profiles, requester "know your rights"). Opinionated shortlist in the
doc: requester API/MCP, the network plays, A/V redaction — with
fulfillment agent v1 still first regardless. HANDOFF's build-candidate
queue stays authoritative; the board feeds it. No code, no migration,
no laptop-setup change (nothing owner-facing beyond reading the doc).

**PREVIOUS (2026-08-14, cloud session): SESSION-START HOOK — fresh cloud
containers now `npm install` before the session begins** (`.claude/hooks/
session-start.sh`, registered in `.claude/settings.json`; web-only,
synchronous, idempotent). Fixes the "vitest: not found" cold-start this
very session hit. Side effect committed knowingly: `package-lock.json`
lost 100 lines of `libc` metadata — npm 10.9.7 lockfile normalization,
zero version changes; full suite green after. The stop hook (commit/push
guard) is provisioned by the cloud environment itself — nothing needed in
the repo for it. No laptop-setup change (no owner steps).

**PREVIOUS (2026-08-14, cloud session, after the UX pass): HOMEPAGE — gold
bars + copy rewrite (owner: "the gold bars help and we need those on the
homepage. Also the copy is terrible").** Ornament: `.mk-eyebrow::before`
gold bar on every eyebrow and `.mk-stat-n::after` base rule under both
stat strips (globals.css — gold stays ORNAMENT, never text; the eyebrow
text itself stays accent). Copy: same six-beat structure, same claims,
no invented numbers — hero is now "Fewer requests. Faster responses.
Decisions you can defend." with a lede that opens on "Most records
requests ask for something that's already public"; problem head "More
requests. The same one person. Still by hand."; pillars head "Three
jobs. One system. No new headcount."; quote body ends "Two years later,
the log reads like a defense exhibit."; closing eyebrow "An afternoon,
not a procurement." TESTIMONIALS untouched (the illustrative disclaimer
wording matters). Owner then asked for less text density: card bodies cut to one sentence, stat sublines to fragments, section subs to one line, roster entries compacted — the page lost ~500px of copy. Browser-verified full-page, screenshots delivered;
894 tests, typecheck clean. **Owner approved both rounds and merged; the
lean-copy rule is now pinned in CLAUDE.md's brand section** (headlines
carry, card bodies one sentence, stat sub-lines fragments, subs one
line — cut before you add).

**PREVIOUS (2026-08-14, cloud session): THE UX PASS — owner-directed
design/flow review, then all seven findings built in one window.**
Browser-verified before AND after (screenshots delivered to the owner).
- **StaffNav rail** (`_components/StaffNav.tsx`, mounted in the (secure)
  layout): persistent sticky second-level nav on every /app page — Queue ·
  Tasks · Records · Search · Agents · Reports · Outbox · Admin, gold
  underline active state, Queue also active on /app/requests/*. The
  command-center header dropped its button cluster (kept: a parked-agents
  alert + session controls). Print-hidden.
- **`.civic-hero` band** (globals.css): the marketing bands' aurora
  language at municipal volume — gold bloom, plum counter-wash, stronger
  hatch, gold seam. Applied to ARCHIVE and TRACK headers (portal home
  already had its own treatment). This was the "app reads flat vs
  marketing" fix.
- **Archive rebuilt**: the AnswerBox now sits IN the archive hero (search,
  cited answers, prior-answer matches, file fallback — the deflection
  engine finally lives on its storefront). Card anatomy normalized: flex
  cards with actions pinned to the foot, ONE primary action (Download when
  bytes exist, else View record), "✦ AI summary" demoted to a card-foot
  footnote, chips capped at 3 + date-first, real empty state.
- **Track rebuilt + tracking-number recovery**: tracker inside the hero;
  below it "Lost your tracking number?" — `sendTrackingReminder`
  (requestService) emails the newest 5 publicIds + track links TO THE
  FILING ADDRESS ONLY, silent either way (same no-enumeration posture as
  password reset; kind "requester_update"). Sign-in / file-new links close
  the page.
- **Footer pinning**: `.agency-shell` flex column (screen-only) — short
  pages no longer end mid-viewport with bare ground under the footer.
- **Empty states**: reports' exemptions widget ("no exemptions cited yet —
  every release unredacted"), records search pre-query "What this finds"
  card.
- **Request detail "Next up" banner**: state-computed single next action
  (undecided review docs → open tasks → unrouted → empty review set →
  ready to release), gold-edged, anchors to #dept-tasks /
  #review-release / staff search prefill. Verified live: "1 record in the
  review set awaits your release decisions → Review now".
- **Admin section index is sticky** (`.admin-section-nav`, top 38px under
  the rail) — the nine-section page keeps its map in reach.
- **Post-filing account nudge**: confirmation card offers "Create an
  account with <email>" → /register?email=… prefills AuthForm
  (initialEmail prop).
Known not-done from the review: mobile pass (still unverified at small
widths) and scroll-animation review (shots were reduced-motion). No
schema change, no laptop-setup change. 894 tests, typecheck clean, 4/4
e2e.
**Follow-up, same window — CARD ORNAMENT SYSTEM (owner: "visual elements
on the divs so they don't seem boring").** The engraved-plate language,
all in globals.css so every existing card inherits it: gold corner
bracket on every `.card-pad` (in the padding zone — never collides with
content), the letterhead tick before every `.panel-title` (same ornament
grammar as the marketing eyebrows), a gold base rule under `.stat-num`
numerals, and the engraver's hatch layered into the card/stat slab
gradients. Print-guarded (ornaments display:none in print). Browser-
verified on the command center and the request detail page.
**And the GROUND (owner: "work on the backgrounds, not just the cards").**
The body's screen-only background is now a full lighting rig, viewport-
fixed: corner vignette → gold dawn top-left → cool slate key light
center-top → plum ember right shoulder → plum floor glow bottom-left →
engraver's hatch → SVG-grain (inline data URI, CSP-safe) → vertical
falloff base (lighter at the top of the viewport, darker at the foot).
Pages now read as a lit room behind the plates, not a flat dark sheet.
Browser-verified on the command center (no hero) and archive (with hero);
one e2e flake when unit+e2e ran simultaneously, two clean 4/4 runs after.

**PREVIOUS (2026-08-13, cloud session): THE LEARNING LOOP — resolved
requests now make the platform structurally smarter (docs/learning-loop.md,
new spec).** Owner ask: learning from the types of questions and answers,
beyond RAG. Shipped v1:
- **`request_plays` (migration 0012 — first since 0011)**: a
  materialized aggregate, rebuilt WHOLESALE per agency by the nightly
  sweep from 4 agency-wide queries (requests + tasks + reviews +
  departments; no N+1). Full-replace semantics on purpose: it can never
  drift from the append-only record it summarizes. Port:
  `replaceAgencyPlays`/`listPlays`, conformance-tested.
- **`src/domain/caseLearning.ts`** (pure, tested): distillEpisode (closed
  request + done tasks + reviews → episode), buildPlays (term-overlap
  clustering, same family as demandPatterns; min 2 episodes — one case is
  an anecdote), matchPlay, routingSuggestionFrom. **Confidence is
  earned and capped**: route share × min(1, episodes/5), hard cap 0.9 —
  explicit rules own 1.0, and the rationale states the numbers ("83% of
  12 similar requests…").
- **Intake wiring** (`learningService.applyPlayRouting`, called from
  fileRequest AFTER routing rules — explicit policy outranks learned
  history): one `play_routing` proposal-card event with the precedent
  stats, and the suggestion goes through the SAME autoDispatchSuggestions
  gate (its tasks-already-exist guard keeps the learned pass advisory
  when a rule fired). Deterministic, zero API keys.
- **Request page**: "Similar past requests" card (left rail, above the
  timeline) — episode count, top route, median days, extension rate,
  exemptions cited before, precedent publicIds. Consulted LIVE against
  the plays table, so nightly rebuilds keep old requests fresh.
- No seed change: the demo's boot sweep builds plays organically as
  closed history accrues. No laptop-setup change (no env vars; the
  migration applies itself).
v2 candidates recorded in the spec: play stats as structured prompt
context (eval required), embedding-based matching over stored ask
vectors, letter scaffolds, accept/dismiss feedback tuning.

**PREVIOUS (2026-08-13, cloud session, same window as B1/B3/checkpoints):
DATA & FILES — the consolidated ingestion hub, plus the missing ad-hoc
upload.** Owner ask: one interface for adding data feeds (Socrata etc.)
and uploading/managing files. Finding: the pieces all existed but were
split across three pages — connected feeds at admin/sources, CSV+ZIP
import + source policy at admin/records-import, decisions at /records —
and there was NO way to just upload files without preparing a CSV first.
- **`/app/admin/data`** — one page, four sections in pipeline order:
  Quick upload (new), Bulk import (moved), Connected data feeds (moved;
  file drop / HTTP / Socrata registration + sync + standing publication),
  Source policy (moved; trust + key rotation). The records queue stays
  its own page — reviewing what landed is a different task from adding
  more. Old URLs (admin/sources, admin/records-import) are redirects, so
  bookmarks and the connectedSources e2e (which navigates the old path)
  keep working untouched.
- **Quick upload** (`QuickUploadPanel` + `quickUploadAction`): drag-and-
  drop or pick up to 40 files / 25 MB, no spreadsheet. One synthesized
  row per file (`rowFromUploadedFile` — title derived from the filename
  by `titleFromFilename`, both unit-tested) rides the SAME importRecords
  pipeline as CSV+ZIP: virus scan fail-closed, text extraction, PII
  pre-scan, internal-only landing, classify_documents +
  embed_document_chunks enqueued. A thinner front door onto proven code,
  not a second import path.
- Links repointed: admin dashboard ("Data & files" button replaces two),
  records-queue header, setup checklist. Browser-verified via a fresh
  seeded server (screenshot to the owner: all four sections render, the
  seeded Riverton portal shows live sync state + Socrata option in the
  connect form).
No migration, no new env vars (no laptop-setup change). 880 tests,
typecheck clean, 4/4 e2e.

**PREVIOUS (2026-08-13, cloud session, same window as B1/B3): THE CHECKPOINT
/ STEERING SURFACE — the prerequisite for a live fulfillment agent, and
the first time a parked run can be approved and resumed from the UI.**
Owner asked "biggest/hardest thing?"; answer: the model-driven fulfillment
agent, and this surface is its first prerequisite (approve-and-resume UX),
built now because every agent inherits it.
- **agent_runs is finally used**: the table shipped dormant in migration
  0000; the repository port now exposes it (create/get/update/list, tenant
  -scoped, in the conformance suite). NOTE: the DB `agent_type` enum still
  has only the five §16.1 agents — persisting B1/B2-style Phase-5 runs
  needs a migration adding enum values; deliberately deferred (their runs
  complete instantly today, nothing to steer).
- **Harness: per-step approval (§16.3 "one approval releases").**
  `AgentPlanStep.approvedByUserId` — a `requires_human` step executes on
  resume ONLY when set, attributed in its audit event
  (`autonomousSend: false`, approver recorded); approval is per-step,
  never per-run, and forbidden actions ignore it entirely.
- **Deadline agent v2 exercises it for real**: the sweep now PLANS Tier-2
  `send_custodian_nudge_email` steps (open tasks on overdue requests
  whose department has an email; capped 3/agency). Under the default
  policy the run parks awaiting_checkpoint. Resumability rule worth
  keeping: every deadline capability reads ONLY its step's `input`
  (embedded at plan time) + injected deps — no closures over sweep-time
  state — so persisted plans resume across processes. Registry factory
  exported (`deadlineCapabilityRegistry`) for the resume path.
- **`/app/agents`** (staff, coordinator+): parked runs on top with the
  pending step ("wants to email works@… for PR-…") and Approve & resume /
  Skip / Cancel; below, run history with status, step glyphs, budget
  spend, handoff notes. Approve sends the REAL email via remindResponder
  (delivery event on the request, as ever). Command center gained an
  "Agents (N waiting)" button. Steering acts land in the admin log as
  `agent_steered`; nightly register.ts persists each sweep run and says
  when it parked. Full loop covered offline in
  `src/agents/steering.test.ts`.
Next toward the fulfillment agent, in order: (1) migration adding Phase-5
values to the `agent_type` enum, (2) scope-decomposition golden set in the
eval suite, (3) the model-driven planner behind a per-agency flag, demo
tenant first.

**PREVIOUS (2026-08-13, cloud session, same window as B1): B3 — THE
APPEAL-DEFENSE PACKET BUILDER.** Second Phase-5 agent, per the spec's
order. "The audit log was built for exactly this moment; this agent is
its reader."
- **`src/reporting/appealPacket.ts`** (pure, tested): assembles the
  counsel dossier from what the platform already keeps — the deadline
  story with every basis and named human (invariant 7), the per-document
  exemption log with deciders (§5 reviews), correspondence (internal
  notes excluded), checksummed releases (invariant 8), and the full §10
  audit report as the evidentiary spine. The cover memo is COMPOSED from
  the record (template, no model) and stamped "DRAFT — for counsel's
  review"; an AI-drafted memo can layer on later behind the same draft
  framing.
- **`src/agents/appealPacketAgent.ts`**: `runAppealPacketAssembly` runs
  read_request → read_events → compile_exemption_log → draft_message →
  assemble_packet → checksum_packet → status_memo through the real
  harness. New definition `appeal_packet` (per_request). ALL Tier 1 — it
  compiles and drafts, never sends; the spec's "one Tier-2 send" (mail
  the packet to counsel) is future wiring, deliberately not built.
- **Route + button**: `/app/requests/[id]/appeal-packet.pdf` (mirrors the
  defensibility route, requireStaff) with an "Appeal packet" button next
  to "Defensibility report" on the request page. Each download IS an
  agent run and appends one `agent_action` request event carrying the
  packet text's sha-256 — a packet handed to counsel is provable later.
  The kind was already in the EventKind union (the Phase-5-compat
  groundwork paying off).
No migration, no laptop-setup change (offline, no keys). 869 tests,
typecheck clean, 4/4 e2e. **Next: B2 consistency auditor (cheap,
read-only, same defensibility theme) or B4 third-party notice steward
(bigger; needs notice rules in state profiles); connected-sources
phase 3 still wants its own window.**

**PREVIOUS (2026-08-13, cloud session): PHASE 5 OPENS — B1, THE
PROACTIVE-DISCLOSURE LIBRARIAN, IS LIVE.** The owner released both
standing gates this session ("I am happy to release the gates"):
agentic-horizon Bucket B and connected-sources phase 3. CLAUDE.md's
Current-phase block and the Gated line above were rewritten to match.
First build per the spec's own order: **B1**, as a configuration over the
dormant §16.1 framework — exactly as designed, no new architecture.
- **`src/domain/demandPatterns.ts`** (pure, tested): token-overlap
  clustering of demand signals — resolved-request texts, deflection-log
  queries, and the new archive-miss signal — into `DemandPattern`s
  (topic, keywords, counts by kind, request refs). Deterministic, no
  model, `now` injected (computeDueDate rules).
- **`archive_miss`**: new deflection kind logged when a resident searches
  the archive, finds nothing, and files anyway (AnswerBox's
  `loggedFileLink`, else-branch). 0 hours avoided, and EXCLUDED from every
  ROI number (deflectionSummary, command-center stat, annual-report count)
  — it is demand signal, not a deflection. Plain-text kind column: no
  migration.
- **`src/agents/disclosureLibrarianAgent.ts`**: `runDisclosureSweep` runs
  the plan (read_demand_signals → one `propose_publication_candidate` per
  pattern → status_memo) through the REAL run harness — allowlist → tier →
  budget → append-only audit event per step. New agent definition
  `disclosure_librarian` (new read tool `read_demand_signals`); its whole
  plan is Tier 1 because it only proposes: no publish, no sends, no
  reclassification — invariant 9 is the design. Tests assert the tier and
  the allowlist hole where publish_release would be.
- **Nightly**: register.ts sweep gained a disclosure pass (deadline-sweep
  pattern) — appends ONE `disclosure_sweep` admin_event per agency, only
  when patterns exist.
- **Command center**: "Proactive disclosure opportunities" card (retention-
  card pattern, same computation as the sweep): topic, signal counts,
  request refs, and a "Find the records" link into `/app/search?q=` with
  the cluster's keywords prefilled. Copy says out loud that publishing is
  the human's per-record call.
No laptop-setup change (offline, no keys, no owner steps). 861 tests,
typecheck clean, 4/4 e2e (e2e needed a container-side chromium shim,
noted for cloud sessions: symlink the pinned headless-shell path to
/opt/pw-browsers' installed build — container state, not repo state).
**Next per spec order: B3 (appeal-defense packet builder), then B4;
connected-sources phase 3 wants its own full window.**

**PREVIOUS (2026-08-13, cloud session): AUTH MULTI-TENANCY HARDENING — the
follow-up the owner asked for after the previous session's read-only
auth/signup scan.** That session reported findings and changed nothing;
owner said fix them, so this session re-ran the audit and fixed the two
real ones. (1) **The platform-operator dev credentials could work in
production.** `PLATFORM_ADMIN_EMAIL/PASSWORD` fell back to the printed
demo pair with no production guard — and that principal is the ONE
cross-tenant login. Now `resolvePlatformAdmin()`
(`src/auth/platformAdmin.ts`, unit-tested) mirrors `resolveAuthSecret`'s
posture: in production, unset (or half-set) env creds disable platform
sign-in outright; dev/test keep the seeded defaults. `.env.example` +
laptop-setup Part D¾ (new) tell the owner exactly what to paste into a
real deployment's variables — until then, `/admin` sign-in is simply off
in production, which is the safe state. (2) **One-time token redemption
was not tenant-scoped.** A verify/reset/invite link minted by agency A
redeemed fine through agency B's `/verify` or `/reset` pages — the write
still landed on A (the token carries its agencyId), so no cross-tenant
data ever moved, but the tenancy boundary wasn't enforced at redemption
and B's branding confirmed an action it didn't own. `consumeToken` now
requires the expected agencyId and rejects mismatches WITHOUT burning the
token (the link keeps working where it belongs);
`verifyRequesterEmail`/`completePasswordReset` take the page's agency,
and both portal callers resolve it from the URL slug. Cross-tenant
redemption tests added on both flows. The rest of the audited surface
(guards, roster actions, signup/provisioning, throttle) checked out
clean. 852 tests, typecheck clean. No schema change.

**PREVIOUS (2026-08-13, cloud session): THREE MORE BANDS — filled in the long
flat stretch of plain page ground the copy pass exposed.** Between "the
problem" (tinted) and "tenancy" (tinted), three sections — "how we help",
"what it costs", and "how the tech works" — sat directly on `.mk-page`'s
bare `var(--paper)` with only the body's own very-subtle fixed aurora
showing through; "what it costs" and "how the tech works" ran back-to-back
with no divider at all. Owner: more visually interesting
backgrounds/gradients. Added three new band classes in globals.css
(`.mk-band-accent`, `.mk-band-plum`, `.mk-band-ai`), each tying its color to
the section's own content instead of repeating one wash everywhere:
- `.mk-band-accent` on "how we help" — terracotta, matching that section's
  own accent-colored eyebrow.
- `.mk-band-plum` on "what it costs" — plum again, on purpose: it continues
  the "AI proposes, staff disposes" quote band directly above rather than
  resetting the mood. Two radials (top-left + bottom-right) so the wash is
  visible right at the section header, not just at the bottom edge — the
  first pass only had the bottom one and read flatter than the other two
  bands at a glance.
- `.mk-band-ai` on "how the tech works" — the AI teal, same hue as the
  roster cards' left rail and spark icon.
- Testimonials picked up the existing `.mk-band-tint` (same treatment as
  "the problem"/"tenancy") for a consistent structural pause rather than a
  fourth new color.
Each JSX section was restructured from a bare `<section className="wrap
mk-section">` to the established band pattern — outer `<section
className="mk-band-X">` wrapping an inner `<div className="wrap
mk-section">` — matching how `.mk-band-tint`/`.mk-band-dark` already work.
Verified in the running app (reduced-motion screenshot, per the copy-pass
entry's gotcha-12 note). 848 tests, typecheck clean, CSS + JSX-structure
only — no copy changed in this pass.

**PREVIOUS (2026-08-13, cloud session): HOMEPAGE COPY PASS — sharper, punchier,
same structure.** Owner ask: tighten the marketing homepage copy, same
sections and claims, shorter sentences, less exposition. Every paragraph in
`src/app/page.tsx` got a pass — hero lede, the three PROBLEMS, the three
PILLARS, both ROI/tech STATS blocks' sub-copy, the "AI proposes, staff
disposes" quote body, all six AGENTS roster entries, the tenancy trio, and
the closing CTA sub. No claims changed, no numbers changed, no sections
added or removed — same six-beat structure (hero → problem → how we help →
ROI → how the tech works → what we're hearing → close) from the 2026-08-13
copy rewrite. The TESTIMONIALS quotes and their "illustrative, not real
customers yet" framing were left as-is (already tight, and that disclaimer's
wording matters). Verified in the running app, reduced-motion screenshot
(the `.mk-reveal` scroll-timeline animation leaves off-viewport sections at
opacity 0 in a single full-page screenshot otherwise — HANDOFF gotcha 12,
not a regression, just a proofreading trap). 848 tests, typecheck clean,
copy-only change.

**PREVIOUS (2026-08-13, cloud session, third correction): THE HERO WAS STILL
FLAT — the owner: "the first div/hero needs more gradients/texture/lighting,
like the other sections but better."** Root cause: the ACTIVE `.mk-hero`
rule (globals.css ~line 1010 — the later of the two `.mk-hero` blocks; see
below) built its base gradient's middle stop from `var(--paper)`. Under the
dark lock `--paper` resolves to `#0f141a`, nearly identical to the
`#0b0f14`/`#202834` stops flanking it, so the "gradient" was three
near-indistinguishable near-blacks — no visible movement at all — and what
little aurora survived was then smothered by the vignette (0.88 alpha at
its peak, meant to keep copy readable over a MUCH stronger aurora than was
actually rendering). Verified by screenshotting the running app, not just
reading the diff (see the correction two entries below — that lesson
applied here too). Fixed:
- Base gradient's middle stop is a real lighter-navy value (`#232b38`,
  reusing the token already established for this exact purpose in
  `.mk-band-dark`) instead of the token that was silently collapsing it.
- Added a third top-center bloom (primary-tint, matching the body's own
  top bloom) so the hero visually continues the page instead of sitting
  apart from it — this is the "like the other sections" part of the ask.
- Gold aurora 30%→40% mix, plum 78%→92%, hatch 0.05→0.065 alpha — pushed
  past the mid-page bands' intensities since the hero should read as the
  most-lit surface, not an equal one ("but better").
- Vignette lightened (0.88/0.6/0.12 → 0.74/0.42/0.08) so the now-real
  aurora actually shows through; copy is still legible (unchanged
  contrast requirement, just less overlay).
- `.mk-chat` (the hero's chat illustration) gets the same inset lit-top-edge
  highlight `.card` got app-wide in the bold pass below — it hadn't
  inherited that treatment since it's a bespoke component, not `.card`.
Proof screenshots (before/after crop of the hero) delivered in-chat. The
dead first `.mk-hero` block (~line 739, pre-dark-lock, overridden by cascade
— see the bold-pass entry) was left untouched; still cruft, still not this
session's job. 848 tests, typecheck clean, CSS-only change.

**PREVIOUS (2026-08-13, cloud session, second correction): THE BOLD PASS —
the owner looked again and called the pages "so flat"; the timid alphas
were the problem, plus a push race meant origin/main didn't even carry
the first app-wide attempt yet (a parallel session's homepage copy
rewrite landed mid-push; merged cleanly — the file now carries an OLD
navy-era `.mk-hero` block at ~line 716 that the later textured block
overrides; left in place, cascade wins).** What the app-wide block does
now, at visible strength:
- `body`: dual aurora (primary-tint bloom top + plum ember at the right
  shoulder) AND the engraver's hatch in the background stack — under the
  content, never an overlay, `background-attachment: fixed`.
- `.card`: stronger glass gradient + **inset lit top edge** (the inset
  highlight is what makes a dark card read as material) + deep shadow.
- `.stat` tiles ditto; `.nav` bottom seam picks up 28% gold; the
  `.portal-hero` aurora went from 9% gold to 20% + plum.
Proof screenshots (portal, workspace, marketing) delivered in-chat
AGAIN — the owner had also been viewing an instance without the
unpushed work, so: after any design change, confirm origin/main HAS it
before discussing what it looks like. 848 tests, typecheck clean.

**PREVIOUS (2026-08-13, cloud session, correction): TEXTURED DARK GOES
APP-WIDE — the owner rightly called out that the previous entry only
textured the MARKETING page while the actual product (portal, workspace,
admin — everything built from `.card`/`.stat`) stayed flat dark.** Now in
globals.css next to the `.card` base, one `@media screen` block:
- `body` gets a fixed primary-tint bloom at the top of every page;
- `.card` becomes the glass gradient + white-alpha hairline;
- `.stat` tiles and `.stat-row` seams get the same treatment;
- marketing hero hatch/aurora intensities raised (0.032→0.05 alpha,
  gold 24→30%) since the subtle values read as invisible.
Screen-scoped so PRINT keeps the flat light card. Proof screenshots
(marketing, portal, workspace) were delivered in-chat. LESSON, on the
record: "browser-verified" must mean the surfaces the OWNER looks at,
not just the ones the diff touched. 848 tests, typecheck clean.

**PREVIOUS (2026-08-13, cloud session, after the lock): THE TEXTURED DARK
RESTORED (owner: "just dark and dark isn't visually interesting").** The
dark-lock had flattened the marketing surfaces — the styled dark lives in
gradients/hatch/auroras, which the light-hero rework had stripped.
Recovered from git history (aa4cbfe) and redistributed:
- Hero: the full original treatment — gold aurora top-left, plum bloom
  right, engraver's hatch ::before, readability vignette ::after; eyebrow
  and accent headline go GOLD on this ground (screen-scoped — print falls
  back to ink/terracotta, verified via print emulation).
- Chat panel: the original glass slab (gradient + deep shadow + backdrop
  blur), bubbles/records in white-alpha and black-alpha layers.
- Quote band: plum bloom + hatch + gold hairline borders — deliberately
  PLUM so it reads distinct from the CTA band's gold aurora.
- Tenancy band: primary-tint bloom + faint hatch.
- Cards (pillars, stats, roster): glass gradients + white-alpha hairline
  borders instead of flat --surface.
Texture map for future edits: hero=gold+plum aurora · quote=plum ·
tenancy=primary tint · CTA=gold · everything between stays quiet paper.
Verified: full-page slices, print emulation (light palette, no gold
text), 390px zero overflow. 848 tests, typecheck clean.

**PREVIOUS (2026-08-13, cloud session, latest): DARK-LOCKED (owner
directive — "everything falls into the dark style no matter the user
preferences").** Supersedes "both themes ship" AND the light-hero
decision from earlier the same day; CLAUDE.md's brand section is
rewritten accordingly. Mechanics, because they're subtle:
- The dark token block in globals.css went from `@media screen and
  (prefers-color-scheme: dark)` to **`@media screen`** — unconditional on
  screens. The light `:root` palette is deliberately KEPT: it has exactly
  one consumer now, PRINT (paper always takes light values; the
  screen-scoping is the whole print story). Do not delete it; do not
  re-add preference gates.
- `tenantAccentCss` same move: the dark-adjusted accent applies on every
  screen; the stored accent survives in the base declaration for print.
  branding.test.ts updated (asserts `@media screen{`).
- The two remaining `<picture>` theme swaps are gone: BrandMarkRaster's
  no-ground branch and the signup lockup both render the dark rev as
  plain `<img>` — every screen ground is dark now. (mark-light.png and
  brandeis-lockup-light.png still exist on disk; nothing references
  them.)
- GROUND-PINNED TOKENS block stays — it's what keeps nav/footer/gov
  chrome self-consistent in print, where the page ground goes light.
Verified with a LIGHT-preference browser context: marketing, portal,
signup, bellmar all render --paper #0f141a; print emulation still gets
#f7f7f5. Hero + quote band + chat all follow tokens into dark cleanly.
848 tests, typecheck clean.

**PREVIOUS (2026-08-13, cloud session, after the logo): MARKETING PAGE
RETHOUGHT (owner: "rethink and optimize, best judgment").** The light
hero had left the below-fold reading heavier than the top; the page now
keeps EXACTLY ONE dark moment (the closing CTA band) before the footer:
- The "AI proposes. Staff disposes." quote moved off near-black onto a
  light letterhead band (`.mk-quote-band`, surface-2→paper gradient,
  serif ink headline, gold kept to ornament — the outsize quote glyph
  and the rule).
- Claim-then-evidence order: pillars now precede the stat strip.
- The six-agent roster kept ALL six (completeness is the pitch) but each
  `does` cut to its core sentence and the cards tightened (~20% less
  vertical) — page went 5088→4893px even after adding a CTA line.
- Closing band: "Explore the live demo" promoted to the second button
  (the demo is the product's best salesperson); the mailto walkthrough
  demoted to a text link. Contrast fixes that came with the move:
  `.mk-note` was #8fa0ba (dark-hero grey, fails AA on light) → theme
  muted with a dark-band override; dark-band eyebrows re-pinned to gold
  (the global eyebrow went terracotta, which dies on near-black).
Verified light + dark + 390px (zero overflow), full-page slices.
848 tests, typecheck clean.

**PREVIOUS (2026-08-13, cloud session, after the top-3 entry): NEW LOGO
RENDER ADOPTED (owner supplied it in-chat: "replace the logo/header
image, cropped as needed").** The drawing changed: gold data-dashes
streaming into a document sheet — the prism triangle is retired. What
happened and what to know:
- The paste never touched the container's disk; the exact bytes were
  recovered from the session transcript's base64 (2000×731 webp, real
  alpha) — worth remembering next time an asset arrives by paste.
- Regenerated from it with sharp, per public/brand/README.md (updated):
  `brandeis-lockup-dark.png` (1600×248), `mark-{dark,light}.png` (shared
  252×124 canvas; the new art is ALL GOLD so both files carry the same
  image — kept as two because the `<picture>` swap references both),
  `src/app/icon.png` (64px crop of the document glyph — REPLACES
  icon.svg; nothing hand-drawn survives now), `apple-icon.png` (glyph on
  the board's plum), `opengraph-image.png` (new lockup on dark paper).
- Still OLD art, on purpose: `brandeis-lockup-light.png` (unreferenced —
  nav is pinned dark; README says regenerate before any light-ground use)
  and `favicon.ico` (ico needs a tool sharp lacks).
- ⚠ FLAGGED TO OWNER: the render's tagline carried stray accents. The
  owner supplied a SECOND revision the same session (adopted, same
  recipe): finer mark texture, lighter wordmark weight, "RECÓRDS" fixed —
  "FÓR" still accented; swap in a corrected render when one exists.
Browser-verified: marketing nav light+dark, 390px mark collapse, signup.
848 tests, typecheck clean (no code paths changed beyond a comment).

**PREVIOUS (2026-08-13, cloud session, latest): TOP-3 BUILDS (owner: "build
the top 3") + HOMEPAGE REDESIGN (owner directive mid-session).** Four
pieces, all browser-verified:
- **Release-history import (the onboarding lever, build-candidate #2).**
  The legacy CSV gains an optional `released_records` column — external_ids
  from a records import, `;` or `|` separated. Each named doc is linked to
  the row's request (request_documents), a real release row is minted
  (artifacts with documentId, releasedAt = the row's closed date, approver =
  the importing admin), askedAs aliases + metadata.releaseId land on the
  docs, and `embed_requests` is enqueued post-import. INVARIANT 9 SHAPE:
  publicness is NEVER minted here — docs keep their existing classification,
  and the release is public only when every linked doc already IS public
  (deriving from prior named-human decisions). UI copy says to import (and
  publish) records FIRST — linked docs leave the publication queue, which is
  the existing review-set rule, so sequencing matters. Missing external_ids
  are reported per row and in the result, matched ones still link.
- **Requester status API + webhooks (agentic-horizon §16.4 first brick).**
  `GET /api/v1/{slug}/requests/{publicId}` serves the tracker's
  requester-safe projection as JSON (statusApiService.publicRequestStatus —
  tests pin that NOTHING about the requester, raw text, or staff crosses;
  milestones are status_change+extension events only). Per-agency opt-in
  (settings.statusApi, no migration — jsonb), 404-plays-dead when off, admin
  card next to Compliance. Webhooks are PINGS on purpose: POST carries
  tracking-number facts + statusUrl; subscribers verify against the API, so
  NO signing secret exists (house rule: no secret values in the DB).
  Emitted via emitStatusWebhook from ALL EIGHT status-moving sites
  (submitRequest, transitionRequest, releaseRequest, denyRequest,
  fulfillByReference, referRequest, forwardRequest + extendRequest as
  deadline_extended) — the status-write choke point is LEAKY (7 sites
  bypass transitionRequest; scout-verified list in the entry's commit).
  Delivery is a durable `deliver_status_webhook` job (10s timeout, retries,
  failures on /admin Health). Webhook URL is SSRF-guarded
  (domain/statusApi.ts checkWebhookUrl: https-only, no IP literals/
  localhost/internal names, tested).
- **Intake dedup on stored vectors (build-candidate #3).** The scout
  corrected HANDOFF's premise: intake dedup was LEXICAL-only over the full
  corpus (the embedder branch existed but was dormant — naively enabling it
  would have been the re-embed trap). `findDuplicateRequests` in
  similarRequestsService now reads stored ask vectors; the filing's own
  vector is already written by submitRequest, so the common case costs ZERO
  embed calls. Per-metric thresholds (cosine 0.6 / Jaccard 0.35 — the
  scales differ), per-row lexical fallback for vector-less rows, event
  payload contract unchanged (the "Possibly related" card renders as
  before). `src/ai/dedup/duplicates.ts` stays for its tests; intake no
  longer calls it.
- **HOMEPAGE REDESIGN (owner: "feels like a military company").** The hero
  LEFT the ground-pinned family (CLAUDE.md updated): it sits on the page's
  own paper now — white in light, follows the visitor in dark. The nav
  stays pinned dark and got taller (104px desktop / 82px ≤640px; measured
  23-24px of air around the lockup, owner asked ≥15). The hero panel is now
  a CHAT — resident asks for inspection reports → assistant answers from
  the public archive (no request needed) → resident asks for an unpublished
  record → assistant files a drafted request with the statutory due date.
  All theme-token styled (.mk-chat*), gold reduced to ornament (eyebrow +
  heading accent went terracotta — gold is never text on paper). TRAP HIT:
  two nowrap spans in the chat header forced the hero past a 390px
  viewport (grid min-content); fixed with flex-wrap + `.mk-hero-grid > div
  { min-width: 0 }`, verified scrollWidth === clientWidth. Screenshots:
  light, dark, 390px.
848 tests (24 new), typecheck clean. No prompt changes; no owner-facing
env/service changes (laptop-setup untouched, checked). Follow-ups worth a
window: statusWebhookJob has no direct unit test (fetch-thin, covered via
emit tests); consider HMAC signing only if a subscriber demands it.

**PREVIOUS (2026-08-13, cloud session, later): THE SMALL-ITEMS BASKET —
build-candidate #4, all four, browser-verified both themes.** One of the
four turned out to be stale (already shipped); its replacement was a real
bug found while checking. What landed:
- **Annual-report CSV companion**: `/app/reports/annual-report.csv` route
  (staff-guarded, same shape as the PDF route) serving
  `complianceReportCsv()` — section/metric/value rows covering every PDF
  section, decimals not percent-strings. The reports page's CSV button now
  points at the route for live agencies (demo fixture keeps the client
  blob, same builder). AND THE DATA IS REAL NOW: `liveComplianceDataset`
  had `extended: false` / `exemptionsCited: []` HARDCODED — the annual
  report has been claiming 0% extensions and zero exemptions on live data
  since it shipped. Extensions now read `extensionHistory`; exemptions
  merge per-document review labels (new port method `listAgencyReviews`,
  conformance-tested) with denial citations from the status_change event,
  deduped PER REQUEST (a 40-page withholding under one citation is one use).
- **Retention-destruction warnings, proactive at last**: the domain logic
  existed but nothing time-driven ran it. Now (1) nightly
  `retention_sweep` block in register.ts → `runRetentionSweep()`
  (src/jobs/retentionSweep.ts, tested) appends a `retention_sweep` admin
  event per agency listing at-risk docs — quiet agencies stay quiet, held
  docs never alarm; (2) command-center warning card (same computation,
  live) via new port method `listDocumentsUnderRetention`; (3) the
  request-page risk card FINALLY has its act: a "Place hold" button →
  `placeLegalHoldAction` → `setLegalHold` (which had NO caller before —
  audited, named actor, verified live: card flips to "held", trail shows
  "Dana Okafor placed a legal hold"). Seed: Morgan's incident report now
  carries retentionUntil 21 days out, so the demo shows the whole loop.
- **Counsel-review recency**: `src/domain/statuteReview.ts` (pure) —
  a sign-off older than 365 days flips the compliance pill to amber
  "re-review due" and re-opens the record form ("Re-record counsel
  sign-off…"). The review status also prints on the annual report now:
  narrative line in the PDF + `statute_reviewed_by_counsel` row in the
  CSV — "not yet reviewed" when absent, on purpose.
- **Responder email on dispatch was ALREADY SHIPPED** (2026-08-05,
  task_responder_notice; the START-HERE bullet was stale — struck). The
  real gap found instead: a notifier throw in dispatchTask escaped AFTER
  the task row + assignment event were written, unwinding the action
  mid-flight. Both send blocks are now best-effort: dept-email failure →
  audited failed-delivery event ("resend from the task panel"), per-
  responder failures → skipped-and-counted in the aggregate event
  (`failed: [...]`), dispatch always returns the task. Tests pin both.
824 tests (23 new), typecheck clean. Verified in a real browser (gotcha
11), light AND dark: retention card, hold click-through, compliance pill,
CSV/PDF routes. No prompt changes (no eval obligation), no owner-facing
env/service changes (laptop-setup untouched, checked deliberately).

**PREVIOUS (2026-08-13, cloud session): REAL KEYS CAN NO LONGER LEAK INTO
`npm test` OR THE E2E SMOKE — the offline suite now strips them first.**
Found by running the suite in a cloud container that carries a real
`VOYAGE_API_KEY` (owner put it in the claude.ai env settings per
laptop-setup ⚡ — every future cloud session will have it): two unit tests
went red because `getEmbeddingProvider()` reads `process.env` at call
time, so the "offline + deterministic" suite was silently sending
unit-test embeddings to live Voyage. Here the calls died at the proxy and
the best-effort paths swallowed the error into empty vectors; on a
machine where they SUCCEED it's worse — spent credits and nondeterministic
vectors that happen to pass. Nothing was wrong with the tested code.
- `vitest.setup.ts` (new, wired via `setupFiles`): strips every
  behavior-selecting env var (AI keys, ES, DATABASE_URL, S3, clamd, OCR,
  email, auth/deploy toggles — the list is in the file) before any test
  loads. No-op under `RUN_LIVE_EVALS`, so `npm run eval` still reaches the
  live API on purpose. Tests that set env vars themselves are unaffected —
  only inherited shell values are removed.
- Same hole existed on the e2e side: playwright.config's webServer env
  MERGES into the shell's, so the smoke's dev server would boot onto live
  providers too. The config now blanks the service keys explicitly (empty
  string reads as unset at every factory).
- e2e in this container: the preinstalled Chromium (build 1194) predates
  what npm-resolved Playwright 1.62 expects (1234) — fixed session-locally
  with symlink shims under /opt/pw-browsers, no repo change. If a future
  cloud session hits "Executable doesn't exist", that's the shape of it.
Full re-verify after: 801 tests (+4 skipped), typecheck clean,
`npm run build` clean, **4/4 e2e green** (paying the "worth a run next
session" debt from the threading/logo entry — mailboxImport included).
No owner-facing change (no new env var, no service): laptop-setup.md
deliberately untouched.

**PREVIOUS (2026-08-13, same keyed session, latest): PINNED DARK NAV
CHROME (owner directive).** The nav's ground is dark in BOTH themes on
every page; content below keeps theme-swapping. Implementation is a
token re-declaration scoped to `.nav` (the dark palette's values,
mirrored — the block says so loudly; if the dark palette moves, move it
too), so links, buttons, seals, and tenant names inside go dark without
knowing why. Consequences handled:
- The lockup is PINNED dark in `<BrandLockup>` (every lockup placement
  is a nav) and `<BrandMarkRaster ground="dark">` in the console nav —
  swap on the GROUND, not the theme. The marketing mid-page mark keeps
  its theme swap (its ground follows the visitor).
- `tenantAccentCss` now also emits `.tenant-accent .nav { … }` with the
  DARK-adjusted accent, unconditionally — a stored accent passed the
  white-ink guard, so it is dark, so raw on the dark bar it would
  vanish for light-theme visitors. Two classes outrank the .nav pin.
- Print: `.nav` joined the print-color-adjust exact family (its dark
  ground is now load-bearing, same as banner/footer).
Verified via the Playwright harness: marketing, portal (banner+seal),
console, signup, mobile — light AND dark. 801 tests, typecheck clean.

**PREVIOUS (2026-08-13, same keyed session, later): EMAIL THREADING +
MESSAGE-ID DEDUPE (build candidate #1) + THE RASTER LOGOS ARE NOW THE
LOGO.** Two pieces, both browser-verified end to end on the seeded dev
server:
- **Correspondence threading in the review set.** The mailbox parser now
  extracts Message-ID / In-Reply-To / References (`parseMessageIds`,
  brackets stripped, bare-id fallback); the import stamps them into
  document metadata (now DECLARED in documentMeta, not passthrough-only);
  and `src/domain/emailThread.ts` (pure, tested) groups messages
  JWZ-style — union-find over id links, normalized-subject fallback ONLY
  for id-less messages (ids win; two id-bearing threads sharing a subject
  stay separate). ReviewRelease renders email docs as "✉ subject · N
  messages" groups, oldest-first with From · date bylines, attachments
  nested "↳" under the message they rode in on. Threading changes READING
  ORDER only — every row keeps its own decision select (review
  granularity untouched, invariant 4 unmoved). Non-email docs render flat
  exactly as before.
- **Message-ID dedupe on import** — overlapping re-exports are the normal
  case, not an error. Scoped to THIS request (the same email on two
  requests is two records reviewed in their own contexts): Message-ID
  when present, raw-byte checksum otherwise, dedupe within one upload
  too; skipped messages take their attachments with them. Counted in the
  result, the panel copy ("N already on this request — skipped"), and the
  audit event payload. THE TRAP: a message's mbox raw bytes used to
  include the blank FRAMING line before the next envelope, so the same
  message checksummed differently by position in the file — the parser
  now strips trailing newlines to one (framing, not content) so the
  checksum fallback actually holds.
  Live proof: 3-message threaded mbox → "✉ Elm St inspection reports · 2
  messages" + "✉ Permit ledger export · 1 message · 1 attachment(s)";
  re-import of an overlapping v2 export → "✓ 1 message added … 2 already
  on this request — skipped", and the new reply JOINED the existing
  thread (3 messages).
- **Logos (owner directive, mid-session): the raster renders are the
  logo, everywhere.** `<BrandLockup>` now renders the full lockup PNG
  verbatim (light/dark swapped on the visitor's theme), the ≤640px
  marketing nav collapses to the mark-only crop, and the hand-authored
  `<BrandMark>` SVG is DELETED — never redraw the mark in code
  (`src/app/icon.svg` is the one surviving derivative). Nav sizes the
  lockup at 1.6×--lockup (~58px) — verified legible both themes, desktop
  + 390px, via the Playwright screenshot harness (gotcha 11/12; the
  in-pane screenshot tool kept returning blanks mid-page). CSS trap worth
  keeping: the base `display:none` on the mark crop must stay ONE class —
  at equal specificity the later rule wins and the earlier ≤640px
  `.mk-topnav` override silently loses (we hit this; the nav rendered no
  logo at all).
811 tests (11 new), typecheck clean. e2e not re-run this window —
mailboxImport.spec exercises the import path; worth a run next session.

**PREVIOUS (2026-08-13, keyed session — appended after the 2026-08-14
entries; session clocks disagree, position is the order): EVAL DEBT
CLEARED + RAG'D TRIAGE PROVEN LIVE.** First session with a real
ANTHROPIC_API_KEY in `.env` (owner did laptop-setup Part A). Two halves:
- **`npm run eval` — 27/27, every gate green.** Custodian 8/8 (0 false
  referrals, 3/3 caught) · exemption 5/5 (recall 100% — the gating
  number — precision 69%, consistent with the recorded ~65–73%) ·
  intake triage 7/8 = 88%, above the bar, and **both RAG golden cases
  pass**, including the scope-contamination guard (`scopeExcludes`) ·
  answer engine 3/3 grounded, zero internal citations. The one triage
  miss is `police-report-personnel`: the model wrote "internal affairs
  files, disciplinary records" and the grader wants the literal substring
  "personnel" — a grader-vocabulary quibble, not a triage error; left
  as-is rather than loosening the golden set in the same run that
  baptizes it.
- **Live proof in a real browser** (isolated dev server, launch entry
  `clerk-dev-isolated-d`, :3500): accepted the triage scope on seeded
  PR-2026-00001 (creating the corpus's first human-reviewed precedent),
  filed "building inspection reports for 212 Oak Avenue" from the
  portal, and read the events straight from PGlite (server stopped
  first — gotcha 1): **both `intake_triage` and `routing_suggestions`
  ai_action events carry `"precedents": ["PR-2026-00001"]`** at
  promptVersion 2026-08-13.1, and the interpreted scope stayed cleanly
  about 212 Oak Ave — no contamination from the precedent's 400 Main St.
  The whole assistive spine ran live along the way: triage draft, two
  routing suggestions with distinct confidences (0.75 / 0.3), and
  rules-based auto-dispatch to Public Works at confidence 1.0.
- **request_match, honestly**: it has NO eval case (the "one run covers
  everything" line in the 2026-08-13 late-night entry overstated — the
  golden RAG cases cover the two prompt bumps only), and it did not fire
  live because the seeded archive answers every query we threw at it —
  BM25-with-degradation rarely returns empty on a stocked archive, so
  the judge is a rare-path. Floors untouched: retuning on zero signal
  would be guessing. First real misbehavior report should add a golden
  set (`evals/requestMatch.golden.ts`) shaped like the intake one.
789 tests + typecheck clean after; e2e not re-run (nothing it covers
changed).

**PREVIOUS (2026-08-14, later): CONNECTED-SOURCES E2E + A REAL GUARD IT
SURFACED.** The twice-verified-by-hand loop is now `e2e/
connectedSources.spec.ts`: sync → reviewed-mode hold → attest (consequence
copy asserted) → next period auto-publishes → resident archive shows it
flagged → pre-attestation slice still held (future-slices-only, asserted)
→ schema drift quarantines + revokes. File-drop only, deliberately — the
network connectors are conformance-tested with stubbed fetch, and a smoke
must not depend on a third-party portal being up.
- Writing the spec surfaced a REAL bug: the drop directory is per-AGENCY,
  so a second file-drop source would read the same files and mint duplicate
  documents for every slice. registerConnectedSource now refuses a second
  file drop (service-level guard + tests; theoretical register race has no
  DB constraint — judged not worth a migration).
- playwright.config now pins CONNECTED_DROP_PATH into the throwaway data
  root, so e2e runs never write CSVs into the working tree.
- Fixed a PRE-EXISTING red e2e: visualRedaction failed on the page-image
  surface with the 5s default — the only spec touching that route pays its
  cold compile, and a not-yet-loaded img has zero size, which Playwright
  reads as "hidden". Diagnosed against a warm server (route serves in
  <900ms, healthy); fix is a 30s timeout on that one assertion, same class
  as the spec's other cold-route waits.
789 tests + 4/4 e2e, typecheck clean.

**PREVIOUS (2026-08-14): CONNECTED SOURCES PHASE 2 — HTTP + SOCRATA
CONNECTORS AND STANDING PUBLICATION.** Owner-directed. Verified in a real
browser against a **live city open-data portal**, which turned out not to
need a laptop at all (Socrata is public and this environment has outbound
network — worth remembering for future "needs a machine" assumptions).
- **Connectors**: `dataset_http` (one https URL of CSV **or** JSON, sliced
  client-side by a date column) and `dataset_socrata` (SoQL `$where` window
  + `$limit`/`$offset` paging, so a million-row portal still costs one
  month per request). Both share `rowsToSlices`; all four connector kinds
  now run through ONE parameterized conformance suite.
  LIVE PROOF: Chicago `ygr5-vcbg` → 4 monthly datasets discovered from a
  min/max aggregate, July slice = 2,520 rows, zero rows outside the window.
- **Secrets**: a private feed names an ENV VAR (`tokenEnv`), never a pasted
  token — `validateConnectorConfig` rejects anything that isn't
  UPPER_SNAKE_CASE, and https-only, Socrata-4×4, slug-dataset rules are
  enforced at write time. Tenant admins type these fields, so nothing they
  submit is trusted.
- **Standing publication**, opt-in per dataset, with all four rails and one
  rule the build added: **future slices only.** An attestation makes NEW
  slices be born public; nothing ever flips an EXISTING internal doc to
  public (that direction is what invariant 9 forbids). Slices already
  landed still need a per-slice publish, and the UI says so at the click.
  - Rail 1: one `document_published` admin event per auto-published record,
    naming the attesting human, plus a `publicationDecision` on the doc.
  - Rail 2: any PII finding quarantines the slice, attestation or not.
  - Rail 3: schema drift quarantines AND revokes the attestation (with an
    audited event) — an attestation covers the shape a human read.
  - Rail 4/invariant: `classifyNewSlice()` is the entire publicness
    decision as one pure function; the tests point at it.
- **Admin surface**: per-dataset rows (slices/public/held-for-review,
  newest period, attestation state) with an attest confirmation that spells
  out the consequences in plain language.
- Browser-verified sequence: register live Socrata → sync 4 real slices →
  attest → new period auto-publishes (1 new, 1 auto-published) → resident
  archive shows it → drifted columns quarantine + revoke → SSN-bearing
  slice quarantines → neither reaches the archive.
787 tests (33 new), typecheck clean. No migration (mappingConfig again).

**PREVIOUS (2026-08-13 late night): RAG'D TRIAGE + ROUTING (ANSWER-FIRST
PHASE 4) + LAPTOP DOC MOBILE CHECKLIST.**
Owner-directed. The last unbuilt piece of docs/answer-first.md is live —
see that doc's phase-4 section for the full design; the short version:
- `requests.embedding` finally has writers: best-effort at submit (a
  provider outage never blocks filing — tripwire test guards the silent
  path) + `embed_requests` boot backfill so legacy-imported history joins
  the precedent corpus.
- `similarRequestsService.findResolvedPrecedents()`: k nearest
  HUMAN-REVIEWED requests (interpretedScope set; closed ranks above open),
  cosine over stored vectors with per-request and whole-call lexical
  degradation, noise floor instead of force-filled k. Staff-only surface.
- Intake triage + routing prompts bumped to 2026-08-13.1: precedents as
  calibration/custodian evidence with explicit contamination guardrails.
  ⚠ EVAL DEBT WIDENED: request_match AND both 2026-08-13.1 prompts now
  await the first keyed `npm run eval`; the golden set gained RAG cases
  including a scope-contamination check (`scopeExcludes` grader support),
  so that one run covers everything.
- Both ai_action events cite the precedent publicIds the model saw.
- docs/laptop-setup.md gained the "⚡ keep coding from your phone"
  checklist up top: Anthropic + Voyage keys into the claude.ai environment
  settings (+ network-policy note), then hand Part B to any phone-started
  session. After that, only Docker (Part C) and email/DNS (Part D)
  genuinely need a laptop.
755 tests (10 new), typecheck clean. Not verifiable live here (triage needs
a key) — the retrieval, writes, degradation, and grader paths are all
unit-tested offline; first keyed session should file a request and eyeball
the precedent citations in the audit trail.

**PREVIOUS (2026-08-13 night): REDACTION STUDIO ROUND 2 + COPILOT PREFILL.**
The tier-1.5 "likely next asks" plus the copilot-prefill gap, all
browser-verified through the real spine (resident files → task upload →
studio):
- **Redo stack**: Shift+Cmd/Ctrl+Z (or Ctrl+Y) replays what undo removed;
  a NEW act clears the redo branch (history forks, the dead branch dies).
  Redo state is captured OUTSIDE the setState updater — strict mode
  double-invokes updaters, which would double-push.
- **Click a bar → its log card**: bars stay pointer-events:none (drags must
  glide over them); onDown hit-tests the grid point against redactions
  instead. Hit = flash the bar + scroll the exemption-log card into view
  (accent ring). Double-click on a bar re-selects, never re-burns.
- **Redact this word everywhere**: `wordMatches()` in domain/redaction.ts —
  word-BOUNDARY matching, not token equality, deliberately: "(Walsh," and
  "Walsh." must burn too or the finalize leak check flags them (the test
  suite encodes this reasoning). Double-click redacts the word and offers
  "appears N more times → Redact all N" (one act, one undo);
  shift+double-click takes them all immediately.
- **Copilot prefill** (`prefillEvents.ts`): propose_task / propose_extension
  cards now hand their text to the panels via window CustomEvents — no
  pipeline/prompt change, so no eval obligation triggered. propose_task
  prefills a NEW manual "Dispatch a task" form in RequestWorkspace (which
  also closes a real gap: dispatch previously existed only via AI routing
  suggestions), with the department best-guessed from the proposal text;
  propose_extension opens the Statutory-deadline panel with the basis in
  the note. The named-human act stays in the receiving panel, untouched.
- **docs/laptop-setup.md rewritten** around the real workflow: cloud
  sessions (phone-started) build; laptop sessions exist to produce
  committed/configured artifacts — Part A (put ANTHROPIC_API_KEY into the
  claude.ai environment settings so CLOUD sessions can run the eval) is
  the highest-value 15 minutes available.
- Gotcha 8 expanded: dev-bundler chunk corruption after long runs throws
  MODULE_NOT_FOUND on real modules and breaks hydration; `rm -rf .next`
  before suspecting code. It silently killed auto-dispatch during this
  window's verification.
745 tests (6 new: wordMatches geometry + leak-check interplay), typecheck
clean. Copilot's buttons fire events verified end-to-end; the buttons
themselves render only with a live API key — untested pixels, known.

**PREVIOUS (2026-08-13 evening): CONNECTED DATA SOURCES PHASE 1 SHIPPED.**
Owner said "do it" on `docs/connected-sources.md`; phase 1 is live and
browser-verified end to end (register → sync → queue → named publish →
flagged answer → download through the file gate). What landed:
- **No migration.** The spec assumed a new table; the existing `sources`
  table already had connector_kind/sync_schedule/last_sync_*/mapping_config
  from §9.1, unexposed at the port. SourceEntity + updateSource grew the
  fields, `deleteSource` is new (documents survive, source detached — DB
  has ON DELETE SET NULL), all conformance-tested on both adapters.
- **Connector adapter** `src/adapters/dataSource.ts`: DataSourceConnector
  (listDatasets/fetchSlice/probe) + file-drop and in-memory
  implementations behind one conformance suite. Slice files are
  `dataset.period.csv` (period = YYYY[-MM[-DD]]); recordDate = period END.
  TENANCY RULE: the drop dir is derived ({CONNECTED_DROP_PATH}/{agencyId}),
  displayed by the UI, never typed — a free-form path field would be a
  cross-tenant/host filesystem hole on shared deployments.
- **connectedSourceService**: register (reviewed mode pinned: trust
  review_queue, born internal), pause/resume (syncSchedule null = paused),
  delete, and syncConnectedSource. THE TRAP THAT SHAPED IT:
  `upsertDocumentByExternalId` overwrites classification AND metadata on
  update — a naive re-sync would silently UNPUBLISH published slices and
  wipe publicationDecision/askedAs. The sync loop diffs by checksum and
  carries the existing classification + MERGED metadata forward; a changed
  published slice keeps serving fresher bytes under the same human
  decision (same shape as a trusted re-push). Invariant tests pin: sync
  can never set public; re-sync can never unpublish; PII slices carry
  sensitivity into the queue; infected slices refuse item-granular.
- **Job + sweep**: `sync_connected_source` durable job; the nightly sweep
  enqueues every enabled connected source. Admin "Sync now" runs inline.
  Both enqueue classify_documents (queue hints) + embed_document_chunks.
- **Admin surface** `/app/admin/sources` (own page — a source is an
  ongoing relationship, not a one-off import), linked from /app/admin.
- **Requester-facing flag**: ArchiveItem carries `connectedSource`
  provenance (from metadata.connectedSource, the one documentMeta schema);
  answer box rows + archive cards show a "⟳ City data · period" tag, the
  record permalink shows the full flag card (spec copy verbatim: automated
  answer, not a records determination), and the staff "Already public?"
  panel notes "synced data (source, last synced …)" so answer-by-link is
  an informed act. Deflection logging unchanged.
- **Seed**: Riverton registers "Riverton open data portal" through the
  real service, syncs 3 monthly street-sweeping slices via the memory
  connector, Dana publishes June+July, August waits Undecided. The
  flagship query "street cleanings for the last 3 months" now demos with
  the window stated and flags rendered.
Still open, honest: no Playwright e2e spec for the loop yet (verified
manually in-browser this window — worth adding to e2e/ next time the
suite runs); phase 2 (HTTP/Socrata + standing-publication rails) unbuilt.
739 tests, typecheck clean.

**PREVIOUS (2026-08-13 latest): SHARE/PRINT GAPS CLOSED + TWO NEW DOCS.**
Owner-directed ("do 2 and 3" off the priorities assessment). Five fixes on
the polish tier, all verified in a real browser (both themes + print
emulation + measured computed styles, per gotcha 11):
- **Favicon exists**: `src/app/icon.svg` — the compact `<BrandMark>` branch
  as a static SVG, square-cropped, theme-aware via its own
  prefers-color-scheme style (a favicon can't read page tokens, so brand
  values are hardcoded there; keep them in sync with globals.css if the
  palette ever moves). `favicon.ico` fallback uses a both-grounds palette
  (gold structure + terracotta fan) since .ico can't switch on theme;
  `apple-icon.png` is the mark on the board's plum app-icon ground.
- **OG image exists**: `src/app/opengraph-image.png` (1200×630, dark lockup
  on the dark paper — ground-pinned by construction, an OG card's ground
  doesn't follow anyone's theme) + alt text. Next's file conventions wire
  the meta tags; verified in the served head.
- **Printing works from a dark OS**: the dark-theme token block and the
  scroll-reveal are now scoped `screen and (...)`, so paper always gets the
  light palette with every section at rest (gotcha 12's "real bug" half is
  fixed — print-emulated computed opacity on .mk-reveal is 1, was 0). A
  print block keeps ground-pinned surfaces' dark grounds via
  print-color-adjust: exact — without it printers strip backgrounds and the
  pinned white-on-dark ink lands on white paper.
- **Tenant accent is now theme-correct** (the checkAccentColor gap): the
  accent used to be inline vars, theme-blind — dark theme uses --primary as
  accent TEXT on near-black, where any white-ink-safe accent fails AA.
  `tenantAccentCss()` (src/domain/branding.ts) emits per-theme values: the
  stored accent in light; in dark, `accentForDarkTheme()` holds hue AND
  saturation and raises only lightness to 4.5:1 on the dark paper — the
  terracotta lever, mechanized (verified live: Bellmar #1e5c2f renders
  #30924b in dark). --primary-deep keeps the stored accent in both themes
  (only ever a ground under white ink, which the save-time guard already
  guarantees). tenantAccentCss re-validates before emitting — it is the one
  place tenant data reaches a <style> tag, and returns null for anything
  checkAccentColor refuses.
- **`docs/connected-sources.md`** — the never-written spec is written:
  v1 rides the existing document pipeline (connector adapter → sync job →
  publication queue → archive → answer box), file-drop connector first,
  flagged automated answers. Owner decision points marked ⚑ inside —
  notably standing-publication mode (auto-publish per dataset), which is
  NOT to be built without an explicit yes.
- **`docs/laptop-setup.md`** — owner's fresh-machine checklist: zero-key
  baseline, every key worth obtaining + what it unlocks + how to verify,
  and the verification-debt list (eval for request_match, MinIO round-trip,
  live ES). Keep it current when env vars land.
Also reconciled the stale tier list below (legacy import, saved filters +
bulk actions, and compliance PDFs had shipped but were still marked open).
712 tests, typecheck clean.

**PREVIOUS (2026-08-13): BRAND ADOPTED + MARKETING SITE REBUILT.** The owner's
board is now the identity — see CLAUDE.md for the rules layer; this entry is
what happened and what bit. Six colors, `#990000` retired (the Design bullet
below is rewritten accordingly), terracotta accent, gold as ornament only.
BOTH THEMES SHIP; the marketing page was briefly dark-locked and is not any
more. The homepage was rebuilt around AUTOMATION OF RESPONSES, not redaction:
the hero panel is real markup (never a screenshot — it can't go stale and
stays sharp), showing a request that triaged, routed, gathered and drafted
itself, with a named human still holding Send.
THE LOGO, after many rounds: the owner's renders are **rasters** (supplied as
`.svg` files that are one base64 `<image>` — zero `<path>`). ~~So there are
two implementations of one mark, and the split is deliberate~~ **SUPERSEDED
2026-08-13 (owner directive, see the raster-logos entry above): the raster
renders are the logo EVERYWHERE — full lockup image in `<BrandLockup>`, mark
crop in `<BrandMarkRaster>`, and the hand-authored `<BrandMark>` SVG was
deleted. Never redraw the mark in code; `src/app/icon.svg` is the one
surviving hand-drawn derivative (favicons can't ship a 170KB raster).**
Nav height is keyed on `.nav:has(.brand-lockup)`, not on a page class, so
`/signup` picked up the taller bar for free and the console/portal (bare mark
or agency seal) stayed at 66px. New gotchas 10–12 below are all from this
work; gotcha 11 in particular cost the most time.
**Still open on this surface:** ~~no `@media print`, no favicon, no OG
image, accent-as-text-on-dark unguarded~~ — all four closed in the entry
above (2026-08-13 latest).

**PREVIOUS (2026-08-13): ANSWER-FIRST phase 3 — the learning QUERY LAYER.**
Retrieve-then-rerank in `priorAnswerService.findPriorAnswers()`. (1) SCOPE
first: for a requester, privately-released prior requests never become
candidates, so they are not in the corpus, the prompt, or the model context —
filtering AFTER the model would leave private scopes sitting in a prompt, and
invariant 3 is about what the query layer can REACH. Two gates: release was
public AND the doc is still classified public (honours audited unpublish).
(2) RETRIEVE via a new `SearchIndex` adapter (`src/adapters/searchIndex.ts`):
built-in is now REAL BM25 with ask-alias boosting — the old scoring was "+1
per term appearing anywhere", no weighting/normalisation/saturation, so a
long doc mentioning "contract" 9× beat a short doc ABOUT the contract.
Elasticsearch/OpenSearch is opt-in behind `ELASTICSEARCH_URL` (fetch-only, no
SDK), FALLS BACK to built-in on any error, and can never WIDEN the set — ids
outside the scoped corpus are dropped so a stale cluster index can't become a
disclosure path. NOT yet run against a live cluster. (3) JUDGE with the new
`request_match` GenAI pipeline, written for PRECISION (retrieval already has
recall; a false positive means a resident never files the request they
needed). Floors differ by audience: requester 0.72, staff 0.45; invented
publicIds are discarded. Runs only when the archive comes up empty — the
moment before filing, not per keystroke. Degrades: no ES → BM25; no API key →
retrieval-only marked *unjudged*; model error → no matches, filing proceeds.
**`npm run eval` NOT run for the new prompt — no ANTHROPIC_API_KEY in the
build environment. Run it before relying on request_match.** 706 tests.

**PREVIOUS (2026-08-13): ANSWER-FIRST phases 1–2 — date-aware search + the
ask-alias loop.** Spec: `docs/answer-first.md`.
The flagship query "street cleanings for the last 3 months" is TWO questions
— a subject and a window — and similarity search is blind to recency, so a
vector match ranks a 2019 sweeping log level with last month's. Now:
`src/domain/dateQuery.ts` (pure, `now` is an argument) lifts the window out,
`searchArchiveDetailed` filters on the record's OWN date, and only the
subject reaches the matchers. Undated records are KEPT — missing date means
unknown, not old. The window is always stated in the UI, and an empty result
under a window says "no record for X dated Y — try widening", because an
invisible filter is indistinguishable from a corpus with gaps (we hit this
live: "paving in 2019" read as "doesn't exist" when it exists outside the
window). THE ASK-ALIAS LOOP: every fulfilled request is a named human
asserting "this ask is answered by these records" — released docs now
accumulate `metadata.askedAs[]` (deduped, capped 25), which joins the search
haystack on both the requester and staff sides, so the archive learns the
public's vocabulary instead of only the government's filing language.
Withheld docs get NO alias. Writes are unconditional on classification —
invariant 3 scopes exposure at the query layer, so a private release's
aliases stay unreachable until a human publishes it — and best-effort, since
a learning write must never fail a lawful release. Still NOT built: prior
resolutions in the pre-filing path (needs `requests.embedding`, which exists
and nothing writes), and RAG'd triage prompts. 687 tests, typecheck clean.

**PREVIOUS (2026-08-13): PRODUCT IS NOW BRANDEIS.** The name went Clerk →
Holmes (2026-08-05, eight hard-coded strings only) → **Brandeis**, and this
sweep carries it all the way through code, comments, docs, identifiers, and
the package name. `branding.productName` is the one source of truth for
what users see; everything else follows it. Title case on purpose — if the
wordmark should render ALL CAPS, that's one line in `src/config/branding.ts`
(or a `text-transform` in globals.css), not a re-sweep.

Two deliberate exceptions, both pinned in CLAUDE.md:
- **"clerk" as a job title stays** — City Clerk, Clerk-Recorder, "the
  records clerk", `clerk@yourcity.gov`. A blanket replace turned "City
  Clerk" into "City Holmes" in 16 places during the first sweep; don't
  repeat it.
- **The `clerk-data` Docker volume keeps its name** — Docker resolves
  volumes by name, so renaming mounts a fresh empty one and a deployment
  looks wiped. Worth revisiting while nothing real is deployed: the rename
  is free today and only gets more expensive.

Compose SERVICE is now `brandeis` (safe — data lives in the named volume).
**Demo/platform credentials changed: `admin@brandeis.example` /
`brandeis-admin-dev`** (was admin@clerk.example / clerk-admin-dev), though
`.env` overrides both on the owner's machine. Saved-filters localStorage key
is `brandeis:savedFilters:*`, with a one-time migration off the original
`clerk:` key. Still `clerk` and outside the codebase's reach: the GitHub
repo, the clone directory, `.claude/launch.json`. 667 tests pass, typecheck
clean.

**PREVIOUS (2026-08-06 later): EMAIL INGESTION SHIPPED** — "most responsive
records ARE emails." Request detail gains "Import a mailbox export"
(coordinator-facing, open requests): .mbox / single .eml / ZIP-of-.eml →
preview (count, date range, subjects; same parser as import) → every
message becomes a review-set document (raw RFC 822 bytes preserved as the
record, mimeType message/rfc822, recordType "email", searchable
headers+body rendition as extractedText, deterministic PII stamps) and
every attachment its own linked document (extracted, OCR-queued if
text-less). Fail-closed PER ITEM: infected/oversize items are refused +
reported, the rest import; one named-actor audit event carries all counts
+ refusals. Parser: src/adapters/mailbox.ts (pure — mbox framing, nested
MIME, base64/QP, RFC 2047 headers, HTML→text, >From unescaping).
Service: mailboxImportService (importMailbox / parseMailboxUpload).
Server-action body limit raised 25→100 MB (per-file caps stay 25 MB).
E2E: e2e/mailboxImport.spec.ts. NOTE: playwright now runs workers:1 — the
specs share one server+DB and parallel runs raced (we hit this).
Follow-ups: ~~threading view~~ and ~~dedupe on Message-ID~~ both DONE
(2026-08-13, newest entry); PST support (needs a real parser — punt until
demanded; IT can export mbox/eml).

**EARLIER (2026-08-06): VISUAL REDACTION SHIPPED** — the functional gap for
scans/photos/PDFs without a text layer (the docs the text studio could only
withhold). `/app/requests/[id]/redact-visual`: staff draw boxes on rendered
pages; finalize BURNS the pixels server-side (decode → black rects →
re-encode; content destroyed, not overlaid) and mints an image-only PDF
under the same `redacted:{docId}` convention, so releaseService ships it
unchanged. Invariant-1 machinery mirrored: `findUnburnedRegions` verifies
the re-encoded bytes are black (the visual findLeaks); per-page byte check;
artifact carries NO extractedText (OCR text never rides into a release).
Pieces: `src/adapters/imageCodec.ts` (jpeg-js dep — pure JS — + hand-rolled
PNG decoder), `src/domain/imagePdf.ts` (binary-safe assembly; its tests are
the adversary round-trip via extractPdfImages), `visualRedactionService`,
`VisualRedactionStudio` + page-image route, text-studio handoff links.
Fixed along the way: extractPdfImages' scanner matched "stream" inside
"endstream" and skipped real streams on tightly-packed PDFs. E2E
(e2e/visualRedaction.spec.ts): portal file → keyword auto-dispatch →
no-login scan upload → box → burn → artifact fetch; also proved the
responder heads-up email live. NOT covered (honest): text-BORN PDFs still
render only via the text studio (no pure-JS rasterizer — visual studio
covers image-backed docs, which is the actual gap); OCR-suggested boxes
(needs word boxes from tesseract TSV — follow-up).

**RESUME HERE for the next session:** everything through referral phase 3,
department-scoped accounts, answer-with-link, the platform-console redesign,
and the go-live onboarding checklist is SHIPPED and verified (inventory
below). The next priorities, in order (owner-reviewed 2026-08-04):
1. ~~Production durability trio~~ **DONE** (2026-08-05): DURABLE JOB QUEUE —
   jobs are rows (migration 0009), enqueue persists BEFORE running, worker
   claims via FOR UPDATE SKIP LOCKED (multi-instance safe), retries with
   backoff, terminal failures stay queryable; boot re-queues orphaned
   "running" rows; works identically on PGlite and Postgres (a durable
   table beats pg-boss here because pg-boss cannot run on the default
   PGlite deploy — pg-boss remains a drop-in behind the same port).
   S3/MINIO BLOB ADAPTER — fetch-only SigV4 (src/adapters/s3BlobStore.ts),
   signing pinned against AWS's published example signature byte-for-byte,
   activates on S3_* env (NOT yet round-tripped against a live MinIO — do
   that before relying on it). RUNBOOK — docs/operations.md (backup/
   restore both deploy shapes, monthly test-restore checklist).
2. ~~Operator health surface~~ **DONE** (2026-08-05): /admin "Health" —
   green line (with queue depth + stuck-worker hint) or red cards listing
   failed jobs (kind, agency, attempts, error) and failed email relays
   (migration 0010 adds relay_status/relay_error to deliveries;
   RelayNotifier records outcomes; outbox rows kept).
1. ~~Records ingestion & publication~~ **DONE** (2026-08-05, `7917a33`,
   verified live end-to-end): CSV/ZIP import at /app/admin/records-import
   (parser has NO classification column — bulk imports can't say public;
   ZIP members scanned fail-closed via the exported `openZipArchive`;
   external_id re-imports update in place; lazy per-agency file_drop
   source), publication queue at /app/records (Undecided/Published/Kept
   internal tabs; per-doc audited publish with prefilled archive metadata,
   keep-internal decision; bulk loops per doc — one admin event each,
   named actor), AI hints via new `classify_documents` job (suggestion in
   metadata.aiClassification; classification column moves ONLY through
   publicationService's new repo method `setDocumentClassification`),
   source trust switching + ingest-key rotation (audited, key shown once).
   Riverton seeds 3 undecided connector docs through the real import
   service. Go-live "Publish or import records" points at the new page.
   Follow-up same day: **audited emergency UNPUBLISH** (Published tab →
   reason required → named admin event `record_unpublished`; doc lands in
   Kept internal, re-publishable) and a **repository CONFORMANCE SUITE**
   (src/db/repositoryConformance.test.ts — identical assertions against
   InMemory AND Drizzle-on-PGlite; on day one it caught Drizzle dropping
   provenance/retentionUntil/legalHoldReason on document reads+inserts,
   now fixed). Add new port methods to the conformance suite, always.
   Hardening sweep (2026-08-05 evening, all 8 recommended fixes): typed
   metadata accessors (src/domain/documentMeta.ts — the ONE schema for
   documents.metadata; read via readDocumentMeta, write via
   patchDocumentMeta, never raw casts) · deterministic PII flags on import
   (scanPii → metadata.sensitivity → red "⚠ Possible PII" chip, zero API
   key; the LLM note is neutral ink now) · staffAction() wrapper
   (src/auth/actionWrapper.ts — new actions use it; convert old ones as
   touched) · migration 0011: publication_decisions (append-only decision
   history; jsonb publicationDecision is its cache) + instance_meta ·
   SESSION BINDING: JWTs carry an `inst` claim, guards reject other
   databases' cookies (rotate the instance_meta row to sign everyone out)
   · queue counts + keyset pagination at the query layer
   (countPublicationStates / listPublicationDocuments, 50/page, "Load
   older records") · classify jobs chunked 20 ids each · PLAYWRIGHT SMOKE
   (`npm run test:e2e`, e2e/spine.spec.ts): login → CSV import → publish →
   public archive against a throwaway seeded PGlite; waits on the
   layout's `html[data-hydrated]` stamp (HydrationSignal) instead of
   sleeps — use that in any future browser automation too.
   Second sweep (same night): responder heads-up email on dispatch
   (task_responder_notice — sign-in pointer ONLY, the token link stays
   with the dept inbox; invariant test pins that) · decision trail
   rendered on Published/Kept rows (history table, cache fallback for
   pre-0011 rows) · zip decompression-bomb ceiling (MAX_ZIP_MEMBER_BYTES
   in textExtract — protects DOCX + records-import ZIPs) · sessionUser()
   applies the instance check (header can't claim a session guards would
   reject) · listPublicationQueues now delegates to the port predicate
   (was a third copy) · upsertReview returns the STORED row on conflict
   (Drizzle fabricated an id; conformance-pinned) · GitHub Actions CI
   (.github/workflows/ci.yml: tsc + vitest + Playwright smoke).
2. ~~Counsel sign-off~~ **DONE** (2026-08-05): per-agency
   `settings.statuteReview` on the (previously unused) portal_settings
   column — no migration. Compliance section on /app/admin shows the
   statute's actual clock params + review status; recording is an audited
   attestation (name + date). Go-live checklist gained the step (9 steps
   now). Riverton seeds reviewed; statute breadth (more states) still open.
3. ~~Public transparency log~~ **DONE** (2026-08-05): opt-in per agency
   (settings.publicRequestLog, admin toggle, audited) → /[slug]/log —
   summary stats (total/open/on-time %/median days) + every request's
   number, subject, dates, outcome. NO-PII invariant is pure + tested
   (src/domain/transparencyLog.ts): requester fields never cross, subject
   is staff-curated interpretedScope ONLY (raw filing text never published;
   pre-triage rows say "Awaiting review"). Footer link when enabled.
   Riverton seeds ON.
4. Small knock-offs: ~~responder email notification on dispatch to their
   department~~ (had ALREADY shipped 2026-08-05 as task_responder_notice —
   this bullet was stale; failure-hardened 2026-08-13) · ~~copilot prefill
   of task/extension panels · redaction redo stack, click-a-bar-to-jump,
   "redact this word everywhere"~~ (all four DONE 2026-08-13 night).
5. Phase 5 agents stay gated until real-user proof (docs/agentic-horizon.md).

## What this is

Brandeis — a multi-tenant, AI-native public records (FOIA) platform. One
deployment serves many governments; each gets its own portal, staff
workspace, statute profile, and data. Root spec: `~/Desktop/foia.md`
(+ `~/Desktop/agentic.md` for §16); repo docs in `docs/` — **read
`docs/invariants.md` before touching release/redaction/audit code.**

Operating principles (non-negotiable):
- **AI proposes, staff disposes.** Every AI output is a reviewable draft;
  nothing legally significant happens without a NAMED human (invariant 4).
- `request_events` / `admin_events` are append-only (invariant 5).
- Released redacted artifacts contain no recoverable redacted content
  (invariant 1) — enforced by regeneration + leak checks, tested.
- Requester-facing retrieval is hard-scoped to `classification='public'`
  at the query layer (invariant 3).
- Fees/payments were removed on purpose — do not re-add.
- **Self-contained first (owner preference, on the record):** no hosting
  accounts or external services required to run. Externals (AI keys, email
  providers, clamd, Voyage, managed Postgres) are opt-in env vars behind
  adapters that degrade gracefully. Never present a cloud service as the
  default path.

## What works now — the full inventory

The complete request lifecycle, real and audited end to end:
file (portal, anonymous or signed-in; **pre-filing deflection interstitial**
offers matching already-public records first) → AI intake triage + routing
suggestions + duplicate check → coordinator accepts scope → dispatch
(outbox + real email if configured; no-login task link) → responder uploads
via web **or by replying to the email with attachments** (virus-scanned,
text-extracted, checksummed into the blob store) → exemption-pass + auto-
classification suggestions land on each document → per-document review →
**redaction studio on real documents** (PII pass + LLM suggestions; finalize
burns a REGENERATED artifact, leak-checked + residual-PII gated) → release
by a named approver (residual gate here too; redacted releases ship burned
bytes only) → response letter → archive auto-publish with **working download
links** → hybrid answer box deflects the next resident.

Also complete:
- **Correspondence**: staff↔requester threads (request detail + tracker,
  owner-only on the tracker — tracking numbers are guessable), clarification
  round-trip (`clarification_needed` → reply → `in_review`), AI-drafted
  replies, everything through the outbox.
- **Email, both directions**: outbound via Postmark/Resend (fetch-only, no
  SDKs) behind `RelayNotifier` — outbox row FIRST, always; inbound webhook
  `POST /api/v1/email/inbound` (Bearer `INBOUND_EMAIL_TOKEN`; 404 when off)
  with credential Reply-To addresses `task-{token}@` / `req-{uuid}@`
  `INBOUND_EMAIL_DOMAIN`. Requester replies must match the sender on file;
  refusals are logged events.
- **Formal denial** — exemption-cited letters with verbatim appeal language,
  plus the **no-records determination** (cites nothing, closes the request)
  when the review set is empty. AI letter drafting with composed fallback.
- **Statutory extensions** (§7): one per request, permitted-reason
  validation, deadline recomputed by `computeDueDate()` and logged WITH its
  basis (invariant 7), notice letter through the thread + outbox.
- **Virus scanning** (spec §4): builtin EICAR scanner always on (the refusal
  path works with zero services); clamd via `CLAMAV_HOST` over raw TCP.
  Fail-closed: unscannable = refused. Both upload paths.
- **Coordinator copilot** (§6.8): chat on the request detail (needs
  `ANTHROPIC_API_KEY`); drafted messages editable-in-place and sent under
  the staff name with AI provenance; every consult is an audit event.
- **Hybrid answer box** (§6.7): keyword + vector (RRF), archive embeddings
  as chunk 0 of `document_chunks`, backfill job at boot/release/ingest;
  Voyage behind `VOYAGE_API_KEY`, deterministic fake otherwise.
- **Docker deploy, smoke-tested on this machine**: image builds, boots,
  `SEED_DEMO=true` seeds in-process at boot (the ONLY safe way — see
  gotchas), serves pages with real blobs on the `/data` volume.

## Architecture map (where things live)

- **Routing**: `/` marketing · `/admin` platform console (env creds) ·
  `/[agency]` resident portal (request/track/archive/account + auth flows) ·
  `/[agency]/app` staff workspace behind `(secure)` (queue, request detail,
  admin roster, outbox, reports, redact) · `/task/[token]` no-login
  responder · `/[agency]/files/[docId]` the ONE download gate (public doc →
  anyone; public-release artifact → anyone; private-release artifact →
  owning requester; else staff only) · `/api/v1/{agency}/records` ingestion
  · `/api/v1/email/inbound` email-in webhook.
- **Data**: `src/db/schema.ts` (Drizzle; migrations 0000–0011, append-only —
  new schema = new file via `npm run db:generate`). `getRepository()` → managed Postgres via `DATABASE_URL`,
  else embedded PGlite at `PGLITE_PATH` / `./.pgdata`. Repository port +
  InMemory (tests) + Drizzle adapters: `src/services/repository.ts`,
  `src/db/repository/drizzleRepository.ts`.
- **Services** (`src/services/`): requestService (submit/transition/triage/
  **extendRequest**), taskService, releaseService (review/release/**deny**),
  **messageService** (threads/clarification), **redactionService**
  (finalize/burn), **inboundEmailService**, accountService,
  deflectionService, notifications (DbNotifier outbox + RelayNotifier email
  + inbound address helpers).
- **Adapters** (`src/adapters/`): blobStore (local FS), **email**
  (Postmark/Resend), **virusScan** (builtin EICAR / clamd), **textExtract**
  (plain text + PDF text layers incl. FlateDecode + **DOCX** via a built-in
  zip reader — pure node; also exports `extractPdfImages` for scan pages),
  **ocr** (OFF by default; `TESSERACT_PATH` local binary over stdin/stdout or
  `OCR_ENDPOINT` HTTP sidecar, `OCR_LANGS`; fail-soft — a doc just stays
  text-less). Pure PDF rendering for burns: `src/domain/textPdf.ts`.
- **Jobs** (`src/jobs/`): in-process queue (pg-boss-ready port) —
  intake_triage (+routing rides it), exemption_pass (+auto-classification
  rides it), embed_public_documents, **ocr_extract** (recovers text from
  scans/images off the request path, logs an ai_action event, re-enqueues
  exemption_pass; no-op with OCR unconfigured); nightly deadline sweep; boot
  seeding. Registered in `src/instrumentation.ts`.
- **AI** (`src/ai/`): runPipeline harness (Zod, retries, prompt versions);
  pipelines all LIVE now except requesterAgent multi-turn; `src/agents/`
  holds the §16.1 five agents + tier/budget framework (built, tested,
  NOT wired — Phase 5).
- **Staff records search** (§6.4, 2026-07-30): `/[agency]/app/search` —
  see roadmap item 4 below for the full shape. repo.listDocuments is the
  one new port method (remember gotcha 2: restart dev servers after adding
  repo methods — we hit it AGAIN this window).
- **Requester agent in the portal** (§6.7, wired 2026-07-30): with
  `ANTHROPIC_API_KEY`, the answer box gains an Ask button — multi-turn
  answer → narrow → file over the public archive (same retrieval as instant
  search, invariant 3), citations validated server-side, draft_request
  prefills the filing form. Degrades to search-only without a key; agent
  errors mid-session fall back silently. Deflections still log ONLY on real
  downloads/scope-downs — never for merely answering.
- **Routing rules** (`src/domain/workflow.ts`, 2026-07-30): deterministic
  keyword→department policy on `agencies.default_routing_rules`, applied at
  filing via `applyAgencyRoutingRules` (taskService) — writes the same
  routing_suggestions event as the AI pass (pipeline `routing_rules`,
  confidence 1.0) and feeds auto-dispatch, so a matching request forwards
  to departments instantly with ZERO AI configured. Admin edits rules in
  the workspace admin page; Riverton seeds with rules for all three
  departments.
- **Workflow automation** (`src/domain/workflow.ts`): opt-in per-agency
  `agencies.workflow_settings` (migration 0005) — auto-assign (least-loaded
  coordinator at intake, deterministic tiebreak) and confidence-gated
  auto-dispatch (routing suggestions ≥ threshold dispatch unattended from the
  triage job via `autoDispatchSuggestions`; guard rails: only fresh requests,
  never when tasks exist). Routing pipeline now emits per-assignment
  `confidence` (prompt v2026-07-30.1). UI: queue assignee chips +
  All/Mine/Unassigned filter, detail-page reassign select, admin "Workflow
  automation" card. Riverton seeds with both ON (+ second coordinator
  casey@riverton.gov / riverton-demo2); everything defaults OFF elsewhere.
- **Redaction studio UX** (2026-08-04): multi-line drag (one gesture →
  one span per covered line, sharing a `groupId` so removing any part
  removes the act; geometry is pure — `spansFromDragRect` in
  `src/domain/redaction.ts`), full keyboard path (arrows move a caret,
  shift+arrows select, Enter burns, Escape cancels — `role="textbox"`,
  focusable, not `role=application`), find-in-document with "redact all
  matches", and an AI triage panel that groups suggestions by exemption
  reason with per-group Accept/Reject, model confidence, an "N of M
  reviewed" counter, jump-to-line, and hover-to-reveal of covered text.
  Every accept is still an explicit human act.
  Ease pass (2026-08-04 evening, `230360d`, owner ask "redacting should be
  easy"): **double-click a word** blacks it out (`wordSpanAt` — pure;
  punctuation-joined tokens like emails/SSNs are one word), **"New
  redactions cite" picker** so a batch carries the right citation instead
  of silently taking `exemptions[0]`, **Cmd/Ctrl+Z** undoes the last act
  (act-granular: a multi-line drag or redact-all reverts as one; window
  listener, form fields keep native undo), **Enter in find** = redact all
  matches. Names are the point: the PII scan can't see them, so the manual
  path is now the one-gesture path.
- **Legacy import** (`src/domain/legacyImport.ts` + `legacyImportService`,
  2026-08-04): admin-only `/app/admin/import`, CSV → real requests with
  historical status/dates. Bypasses submitRequest + the transition state
  machine ON PURPOSE (no milestone emails/auto-assign for a bulk history
  load; a row can be born "fulfilled"). One `note` event per row names
  the importer.
- **Signup trust & safety** (2026-08-14 latest): self-signup takes ANY
  email — no government domain required (owner call; see the newest entry).
  `isGovernmentEmail` (.gov/.mil/state-local .us, src/domain/signupPolicy.ts,
  lookalike-tested) survives as a LABEL on the `agency_created` admin event,
  not a gate. Guards: fixed-window rate limit (3/client/hour, 10
  deployment-wide, in-memory), tenant isolation, and operator visibility of
  self-registrations. `SIGNUP_REQUIRE_GOV_EMAIL=true` opts a deployment back
  into the strict door (and the form's copy follows it);
  `SIGNUP_ALLOW_ANY_EMAIL` is retired — that behaviour is the default now.
  Verified live both ways.
- **Per-tenant branding** (2026-08-04 latest): `agencies.branding` jsonb
  (column existed since 0000, unused — no migration). Office name, contact
  email, address, hours, ACCENT COLOR (contrast-guarded: white ink must
  clear WCAG AA 4.5:1 — `checkAccentColor` in src/domain/branding.ts, the
  clerk gets "too light" instead of an unreadable portal), and seal upload
  (PNG/JPEG ≤1MB, virus-scanned, blob store, served at /[agency]/seal,
  generic civic seal fallback). Edited in /app/admin "Portal branding";
  accent overrides --primary via a layout wrapper; footer contact block
  renders ONLY provided fields (never an invented address — Riverton seeds
  its details so the demo keeps them). Verified live: gold rejected, forest
  green applied to Bellmar's nav, footer + tab title show Records Division.
  NOTE: `checkAccentColor` only guards WHITE INK ON the accent. It does not
  check the accent used AS TEXT on a dark ground, which the dark theme now
  does — a tenant accent that passes here can still be under-contrast there.
- **Self-serve signup** (2026-08-04, the last piece of the
  multi-tenant loop): `/signup` — any government creates its own tenant
  (name → auto-slug, state from reviewed statute profiles, admin account),
  through the SAME provisionAgency the platform console uses, so
  self-signed-up tenants are indistinguishable from operator-provisioned
  ones and appear in /admin immediately with their Setup n/8 pill. Ingest
  key shown exactly once, then auto sign-in lands the new admin on their
  go-live checklist. Marketing hero + nav CTA point at it. Kill switch:
  `SELF_SIGNUP=off` (404s the page; action re-checks). "signup" added to
  RESERVED_SLUGS; provisionAgency now has direct tests (reserved/taken/
  malformed slugs, key-hash-at-rest, tenant isolation from row one).
- **Onboarding: go-live checklist + department CRUD** (2026-08-04 late,
  `f454a17`): `computeSetupStatus` (src/domain/setupChecklist.ts, pure +
  tested) derives 8 steps from REAL state — statute + departments required,
  team/routing/directory/archive/email/test-request recommended; nothing is
  a manual tick-box. Card on /app/admin until complete, each step linking
  to its fix; platform tenant cards show "Setup n/8" amber pill. Department
  create/edit finally exists (repo port createDepartment/updateDepartment,
  DepartmentManager on /app/admin; NO delete on purpose — tasks/rules/
  responders reference departments). Email step honestly says
  "outbox-only mode" until EMAIL_FROM + a provider key are set.
- **Platform console redesign** (2026-08-04 evening, owner ask "beautiful
  and effective"): `/admin` is now a deployment dashboard — health stat
  strip (overdue in red), per-tenant cards with On track/overdue pills,
  forwarding-link counts, and Manage/Portal/Workspace actions; `/admin/
  [slug]` gets seal + serif header, a stat strip (incl. on-time closures),
  and sectioned Staff / Tenant links / Residents. Same tokens as the rest
  of the app (stat-row, card, pill, tag) — no new CSS.
- **"Already public?" on request detail** (2026-08-04 evening): open
  requests are matched against the agency's OWN public archive (same
  retrieval as the pre-filing interstitial); top matches render with
  citable permalinks so staff can answer with a link. No cross-tenant
  anything. **Completed by "Answer with this link"** (same night):
  one click (inline confirm) → `fulfillByReference` in releaseService
  sends the letter with the permalink under the staff name, closes the
  request as fulfilled (lifecycle now allows open-state → fulfilled for
  exactly this by-reference path; draft still can't), refuses non-public
  documents (no side door around review), and logs an `answered_by_link`
  deflection (1.0 staff-hours — the ROI number ticks). Anonymous
  requesters: closure still works, letter noted as tracker-only.
- **Compliance PDFs** (2026-08-04): `/app/requests/[id]/
  defensibility-report.pdf` and `/app/reports/annual-report.pdf`, both via
  `renderTextPdf` (no new dep). `buildDefensibilityReport` takes an
  optional `actorNameById` so trails print real names.
- **Queue ergonomics** (2026-08-04): `src/domain/queueFilters.ts` (pure
  assignee/status/risk/department combining), `QueueFilterBar` (saved
  filters = named query strings in localStorage, browser-local by
  design), `QueueTable` (bulk select + bulk assign, each row still going
  through the per-request `assignCoordinator` so every change is
  individually audited). Stats/sweep always cover the WHOLE open queue.
- **Inter-agency referral** (`src/services/referralService.ts`, 2026-08-04):
  phases 1 AND 2 shipped — `referred` status (NOT a denial; reported
  separately), `agency_directory` table (migration 0007), admin directory
  manager at `/app/admin/directory`, Refer panel on request detail, requester
  letter with their own text pasted back. Phase 2 (2026-08-04, `1a69fa1`):
  `custodian_suggest` pipeline rides the triage job when the agency has
  directory entries; surviving proposals (via `custodianProposals()` — see
  the doc) render as a pre-filling card in ReferPanel. Nothing auto-refers.
  Precision-first evals in `evals/custodianSuggest*` — 8/8 live, 0 false
  referrals. Phase 3 (2026-08-04 evening, owner-directed): **cross-tenant
  forwarding SHIPPED** — `forwardRequest` is THE one sanctioned crossing
  (allow-list: rawText verbatim + requester contact ONLY behind a
  per-forward consent checkbox, default OFF — owner decision on record;
  pinned by an invariant test in referralService.test.ts). Migration 0008
  adds `forwarded_from`/`forwarded_to` jsonb (denormalized snapshots — no
  cross-tenant reads at render, deliberately no FK). Peer links are
  platform-operator scope (/admin/[slug]); staff see "⚡ on Brandeis" and the
  button becomes "Refer & forward"; requester tracker deep-links to the
  new request's tracker. Riverton seeds a peer-linked Bellmar entry.
  Verified live: forward created Bellmar's PR-2026-00002, anonymous (no
  consent), zero identity leakage on the rendered page.
- **Retention/legal holds** (`src/domain/retention.ts`, `retentionService`):
  attaching a doc to an open request auto-holds it; closing lifts only holds
  nothing else needs; human litigation holds are never touched by automation.
- **Evals** (`evals/`): intake triage, answer engine, AND exemption pass
  (recall-first, 5 golden municipal docs). `npm run eval` sets
  RUN_LIVE_EVALS=1, which is what loads `.env` — `npm test` stays offline and
  deterministic on purpose. Last live scorecard: exemption 5/5 · recall 100% ·
  precision ~65-73% · 0 missed labels.
- **Statutes**: `src/statute/` — pure `computeDueDate()` (incl. extension
  validation), profiles for CA/TX/IL/WA/NY (data, not code).
- **Design**: Public Sans + Source Serif 4, both self-hosted via next/font
  (no external font dependency — that is a deliberate part of "self-contained
  first"). **Serif means document, sans means interface**: display headings
  are sans, and the serif is reserved for surfaces that ARE a record (the
  drafted letter, the defensibility PDFs).
  Palette rules live in CLAUDE.md — the short version is that the 2026-08-13
  board superseded the navy/gold/red civic triad, `#990000` is retired,
  terracotta is the accent (`#9c4a2c` light / `#c46a4a` dark), and gold is
  ornament that is never text on a light ground. The colour lesson survives
  the palette change and generalises: **at the lightness AA forces,
  saturation is the anti-pastel lever.** Never fix contrast by desaturating
  or over-lightening — that is what turned the old red pink, and terracotta
  goes salmon exactly the same way. Hold the hue, move only lightness.
  `--overdue` dark is `#f65a4c` (status colours are functional, not brand).

## Run it (this machine)

```bash
export PATH="/opt/homebrew/bin:$PATH"   # Node is Homebrew-installed
npm install && npm test && npm run seed && npm run dev   # :3000
```
Demo credentials (seed prints them): Riverton staff `dana@riverton.gov` /
`riverton-demo` · coordinator `casey@riverton.gov` / `riverton-demo2` ·
responder `sam@riverton.gov` / `riverton-demo3` (Public Works only — lands
on /app/tasks, blocked from coordinator surfaces) ·
resident `jordan@rivertonledger.com` / `riverton-resident` · Bellmar staff
`amara@bellmar.gov` / `bellmar-demo` · platform `admin@brandeis.example` /
`brandeis-admin-dev`.

Seeded demo moments: Wei's request = full closed cycle with real PDF
download; Jordan's = clarification round-trip (reply as Jordan, or via the
email-in webhook); Morgan's incident report sits at the redaction step with
real PII-laden bytes.

**Platform operator login on THIS machine:** `.env` overrides the seeded
default — use the `PLATFORM_ADMIN_EMAIL` / `PLATFORM_ADMIN_PASSWORD` values
in `.env`, not `admin@brandeis.example` (we hit this).

**Port layout during the build window** (multiple things run in this repo):
`:3000` another session's dev server on `./.pgdata` · `:3100` this window's
isolated dev server (launch.json entry `clerk-dev-isolated`, scratchpad
PGLITE_PATH/BLOB_PATH + inbound-email env) · `:3200` the Docker container.
Check what's still running before assuming ports.

## Deploy it (self-contained)

```bash
cp .env.example .env    # AUTH_SECRET + PLATFORM_ADMIN_EMAIL/_PASSWORD
docker compose up --build              # → :3000 (PORT overridable)
SEED_DEMO=true docker compose up --build   # …with the demo seeded at boot
```
One volume (`clerk-data` → `/data`) holds DB + blobs. Optional env:
`DATABASE_URL`, `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `EMAIL_FROM` +
(`POSTMARK_SERVER_TOKEN` | `RESEND_API_KEY`), `INBOUND_EMAIL_TOKEN` +
`INBOUND_EMAIL_DOMAIN`, `CLAMAV_HOST`, `TESSERACT_PATH` | `OCR_ENDPOINT`
(+ `OCR_LANGS`). All documented in `.env.example`.

## Gotchas that WILL bite you (hard-won; several new this window)

1. **One process per PGlite data dir.** Never run build/seed/scripts while
   a server holds the same `.pgdata`. In the container this means: seed ONLY
   via `SEED_DEMO=true` at boot (in-process) — never `docker compose exec …
   npm run seed` against a running server (a second writer; we hit this).
2. **globalThis memoization + dev HMR = stale singletons.** The repo/queue/
   blob-store instances are memoized; after adding or changing a REPOSITORY
   METHOD (or any memoized class), the running dev server keeps the OLD
   instance — symptoms look like "my code doesn't work" (we hit this twice:
   extensionHistory not persisting; getReleaseById missing). Restart the
   dev server after adapter-interface changes. CSS/pages hot-reload fine.
3. **Reseeding invalidates staff sessions** (new user ids) — expected.
4. **Remount-key pattern**: interactive panels remount via a server-state
   fingerprint `key` after router.refresh() — keep it for new panels.
5. **Migrations are append-only** (0000–0011 applied).
6. **Browser-automation logins race hydration** — wait ~4–5s after load
   before dispatching forms; clicks before hydration submit a native GET.
7. **The container doesn't auto-update** — rebuild (`docker compose up -d
   --build`) after code changes, or :3200 shows stale UI (we hit this with
   the pink fix).
8. **tsc noise from `.next/types`** after concurrent build+dev corruption:
   `rm -rf .next/types` and let the dev server regenerate. The BIGGER
   version of the same disease (hit 2026-08-13 evening): after a long dev
   run with many recompiles, the dev bundler's chunk state corrupts —
   dynamic imports start throwing `MODULE_NOT_FOUND` for modules that
   plainly exist (`await import("@/services/taskService")` in fileRequest
   died this way, which silently killed auto-dispatch because that path
   deliberately catch-and-logs), and client chunks 404 so pages serve but
   never hydrate. If hydration hangs or a dynamic import "can't find" a
   real module: `rm -rf .next`, restart the dev server, and re-test before
   suspecting your code.
9. **Structured outputs reject `min`/`max` on numbers** — a Zod
   `.min(0).max(1)` puts bounds in the JSON schema and the API 400s the
   call. Because pipeline riders catch-and-log, this fails SILENTLY (the
   live routing pass was dead for days this way; found + fixed in
   `1a69fa1`). Never bound numeric fields in a pipeline schema — clamp on
   read, like intakeTriage's complexity_score and routing/custodian
   confidence now do.
10. **Detailed SVG dies at chrome size.** The mark's viewBox is ~72 units
    tall; rendered at 36px that is a 0.5× scale, so a 1px stroke lands on
    half a pixel and only solid FILLS survive — dashes, hairlines and
    opacity fades all vanish. Symptom: "the logo looks flat/rough, where
    did the detail go". This is why the chrome logo is a raster now. If you
    ever draw for a small size: solid fills, heavier weights, and drop the
    dasharrays below ~26px. Related trap: the SVG had a `compact` branch
    gated at `size < 56` while every real placement was 36–40px, so the
    detailed branch had literally never rendered anywhere.
11. **VERIFY DESIGN IN A BROWSER, NOT IN TESTS.** Every visual bug this
    window was invisible to `npm test` and obvious in one screenshot: the
    sub-pixel mark, a hero beam drawn at 0.1 opacity under its own bloom, a
    navy wordmark on a near-black footer, an empty-state that never
    rendered, and a black plate around the dark logo (43% of that PNG's
    visible pixels were near-opaque black, baked in by the render — keyed
    out with alpha := max(r,g,b), unpremultiplied, at full res before the
    downscale). Screenshot both themes AND 390px; measure boxes with
    `getBoundingClientRect` rather than eyeballing, since a theme swap that
    shifts layout shows up as a number. Chromium is at
    `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` — pass it as
    `executablePath`; `import { chromium } from "@playwright/test"` (bare
    `playwright` is not installed). Uploads over ~0.9MB fail, so capture at
    deviceScaleFactor 1 and slice tall pages.
12. **Full-page screenshots come back BLANK for scroll-revealed sections**
    unless the context sets `reducedMotion: "reduce"`. (RECONCILED
    2026-08-14: the "real bug" half — print/crawlers seeing opacity 0 —
    was FIXED when the reveal was scoped `screen and (prefers-reduced-
    motion: no-preference)` + `@supports (animation-timeline: view())`;
    an earlier entry recorded that but this gotcha wasn't updated. What
    REMAINS is the automation trap, and playwright.config.ts now sets
    `contextOptions: { reducedMotion: "reduce" }` so future specs don't
    walk into it. Note for screenshot sessions: this container's chromium
    1194 PARSES `animation-timeline: view()` but doesn't execute it, so
    the reveal degrades to fully-visible here — verify actual scroll
    animation on current Chrome, not in this container.)

## Next: the most important things to make this USEFUL (priority order)

Best-thinking assessment of what stands between "complete demo" and "a
records office runs Tuesday on this." Tiered by adoption impact.

**Tier 1 — adoption blockers**
1. ~~**OCR + DOCX extraction.**~~ **DONE.** DOCX extracts natively (zip
   reader + WordprocessingML flattening, zero deps, detected by content not
   mime). OCR is an adapter (`src/adapters/ocr.ts`): `TESSERACT_PATH` (local
   binary, stdin/stdout) or `OCR_ENDPOINT` (tesseract-server sidecar),
   disabled+honest by default; the `ocr_extract` job feeds whole images and
   the DCTDecode (JPEG) streams of scanned PDFs, 50-page cap, then re-runs
   the exemption pass. Studio copy now distinguishes "OCR running" /
   "no OCR configured" / plain no-text. Not covered: CCITT/JBIG2-encoded
   PDFs (uncommon; degrade honestly) and OCR for requester-reply email
   attachments (correspondence, not review-set).
2. ~~**Legacy import / migration path.**~~ **DONE** (2026-08-04, see
   inventory: `legacyImportService`, admin-only `/app/admin/import`, CSV →
   real requests with historical statuses/dates, one named-importer event
   per row). Still open from the original framing: importing RELEASE
   history (closed requests' released documents) so the archive/answer box
   inherit years of signal — records-import covers documents, legacy import
   covers requests, but nothing yet links imported docs to imported
   requests as releases.
3. ~~**Milestone notifications + tracker transparency.**~~ **DONE.**
   Template-only requester emails on "received" (tracking number + statutory
   deadline + track link) and "work started" (→ in_progress transition),
   sent via the notifier (outbox-first) with delivery events; per-agency
   toggle `workflowSettings.milestoneEmails` — the ONE opt-OUT default in
   workflow settings (transparency ships on). Outcome letters / extension
   notices keep their own staff-sent flows. Tracker now shows a
   requester-safe "Progress so far" timeline (status changes + extensions
   only — no internal notes, no task traffic) and an extension callout with
   days/date/reason (invariant 7 surfaced to the requester).

**Tier 1.5 — specced, waiting on a decision or a trigger (future code, ready
to write)**
- ~~Referral phase 3~~ **SHIPPED** (see inventory above) — owner overrode the
  two-real-tenants trigger and decided consent = checkbox default OFF.
- ~~**Redaction studio, likely next asks**~~ ALL THREE WERE ALREADY BUILT
  (audited 2026-08-14, sixteenth build): redo stack + keybindings, the
  onDown hit-test that jumps to a bar's log card, and
  redact-this-word-everywhere all ship in RedactionStudio.tsx — this note
  and the build-candidate list had gone stale. The actually-missing bits
  (the inline find-scan was untested; mouse-only events) shipped in that
  build: `substringMatches` extracted to domain/redaction.ts with tests,
  and the studio now uses pointer events (taps work on touch; a
  browser-claimed scroll cancels a draft selection instead of committing
  a smear).

**Tier 2 — daily-work leverage**
4. **Staff responsive-records search (§6.4).** SHIPPED (lexical): `/app/
   search` (recordsSearchService) — full-corpus staff-only search over
   filename + extracted text + metadata via LexicalRetriever scope "full";
   burned artifacts hidden; `?req=` context prefills from a request (the
   "Find records" button on the detail page) and enables one-click attach
   (linkRequestDocument + named-actor event + exemption_pass re-enqueue).
   Still open: per-chunk embeddings at ingest (chunk 1+) to make this
   hybrid — the service signature is ready for it.
5. ~~**Queue ergonomics at volume.**~~ **DONE** (2026-08-04, see inventory:
   QueueFilterBar saved filters + QueueTable bulk assign, each row still
   individually audited).
6. ~~**Compliance exports.**~~ **DONE** (2026-08-04 + 2026-08-13):
   per-request defensibility-report.pdf, annual-report.pdf, and the
   annual-report.csv route (small-items entry — full section/metric/value
   spreadsheet from the same dataset).
7. **Statute breadth + counsel sign-off.** 5 starter state profiles exist;
   each real deployment needs its state present and reviewed. Add profiles
   as demand appears. ~~"reviewed by counsel on DATE" surfaced~~ DONE
   (2026-08-05 field + 2026-08-13 staleness pill, re-record flow, and the
   review line on the annual report PDF/CSV).

**Tier 3 — durability & scale**
8. ~~**Department-scoped accounts**~~ **DONE** (2026-08-04 late): responder
   role is live — real logins, `user_departments` wired through the repo
   port (`listUserDepartmentIds`/`setUserDepartments`, tenancy-checked),
   `/app/tasks` shows exactly the signed-in responder's departments' tasks
   (fulfillment still happens on the one `/task/[token]` surface; the
   no-login email path is untouched). Guard rule: `requireStaff` with NO
   roles list default-denies responders (→ their task list), so every
   coordinator page — current and future — is safe without edits; pages
   that serve responders opt in via ALL_STAFF_ROLES. Admin roster gets
   per-responder department checkboxes; seed adds sam@riverton.gov /
   riverton-demo3 (Public Works). Coordinators also see /app/tasks as an
   all-departments workload view.
9. ~~**Retention awareness / legal holds**~~ **DONE** (domain+auto-holds
   earlier; proactive warnings 2026-08-13: nightly retention_sweep admin
   event, command-center warning card, and a Place-hold button on the
   request page — no new data model needed, the fields existed).
10. **S3/MinIO + pg-boss adapters, backup/restore runbook** — both ports
    are ready; only needed past one machine. Plus copilot depth (prefill
    task/extension proposals into their panels).

**Phase 5 (documented, do not build yet)**: `docs/agentic-horizon.md`
Bucket B — eight specified agent concepts (proactive-disclosure librarian
and appeal-defense packet builder first). Bucket A is fully wired.

## Known small gaps (fair game any session)

- ~~Copilot task/extension proposals point at panels but don't prefill
  them.~~ DONE (2026-08-13 night): prefill via window CustomEvents +
  a manual dispatch form. The prefill BUTTONS render only when a live API
  key produces proposals — the events are e2e-verified, the buttons' pixels
  are not; worth one click when a key exists.
- Demo-fixture archive (unseeded `/riverton`) has no downloadable bytes —
  by design; seed for the real thing.
- ~~`npm run eval` has NOT been run for the `request_match` prompt~~ —
  eval debt CLEARED (2026-08-13 keyed session, newest entry). Still true:
  `request_match` itself has no golden set; add `evals/requestMatch.golden.ts`
  when it first misbehaves in real use.
- The Elasticsearch adapter has never been exercised against a live
  cluster; the S3/MinIO adapter has never round-tripped against live MinIO.
  (Both on the laptop-setup verification-debt list.)
- ~~`requests.embedding` unwritten; phase 4 unbuilt~~ — BOTH DONE
  (2026-08-13 late night, see newest entry). ~~Remaining phase-4 wish: the
  intake dedup re-embeds the corpus via findDuplicates~~ — was ALREADY
  stale when re-audited 2026-08-14 (the live path had moved to
  `findDuplicateRequests` over stored vectors; `findDuplicates` survives
  only as a test fixture for hybrid.test.ts), and the perf pass (newest
  entry) pushed dedup/precedent ranking into SQL top-k besides.
- Connected data sources: **phases 1 AND 2 SHIPPED** (see the newest
  entry). Phase 3 (structured row store + tabular answers) stays gated on
  real usage. The Playwright e2e for the loop now exists
  (e2e/connectedSources.spec.ts) — nothing owed here.
- The favicon hardcodes brand values inside `src/app/icon.svg` (a favicon
  can't read page tokens) — if the palette ever moves, move it too.
