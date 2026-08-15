# Executive reporting

The report a clerk hands to a city manager, mayor, council, or department
head: what came in, what went out, and how the office performed — for a
period the clerk picks. Owner-directed (2026-08-15): daily / weekly /
monthly **windows chosen at generation time**, "pretty PDFs", and
user-customizable sections. Deliberately NOT scheduled — the owner cut
scheduling from the design; the report is generated on demand and is
deterministic from the request log, so any period can be regenerated
byte-identically later.

## What shipped (v1)

- **`src/reporting/styledPdf.ts`** — the styled PDF engine. Dependency-free
  byte-level PDF assembly (the `textPdf.ts` idiom, grown up): PDF
  standard-14 Helvetica with real AFM width metrics for measured wrapping,
  WinAnsi text encoding (em/en dash, curly quotes, middle dot map to their
  bytes; unknown glyphs degrade to `?`), fill/stroke primitives, multi-page
  flow with `ensureSpace` page breaks, an `onPageBreak` running-header hook,
  and footers drawn at finalize time when the true page count is known.
  Callers work in distance-from-top coordinates; the engine converts to
  PDF's bottom-left origin. It exists so every future typeset artifact
  inherits it — `renderTextPdf` stays for release artifacts and
  defensibility exhibits, where typewriter plainness is a feature.
- **`src/reporting/executiveSummary.ts`** — pure period windowing + metrics
  (computeDueDate idiom: no I/O, no clock reads, reference date is an
  argument, every section carries a `basis` string). Half-open UTC windows:
  day, Monday-start week, calendar month; `priorPeriod` for deltas;
  `trailingPeriods` for the trend (14 days / 8 weeks / 6 months). Also home
  of `EXECUTIVE_SECTIONS`, the section catalog the builder UI and renderer
  share (it lives here so the client bundle never imports the Buffer-using
  engine).
- **`src/reporting/executiveReportPdf.ts`** — pure renderer: ink masthead
  with gold seam (gold is ornament, never text on the light ground), KPI
  tiles with prior-period deltas, dual-bar trend, on-time/late proportional
  band, outcomes + exemptions, department table, transparency impact.
  Hardcodes the brand's LIGHT palette (a PDF has no CSS tokens); functional
  status colors for valenced deltas only.
- **`src/lib/reportingData.ts` — `liveExecutiveDataset`** beside
  `liveComplianceDataset`, sharing one `citationSources` helper so the two
  artifacts can never disagree about what an exemption count means.
- **Route** `/{slug}/app/reports/executive-report.pdf?period=&date=&sections=&note=`
  (staff-guarded, coordinator posture — `requireStaff` with no roles list, so
  responders are default-denied). **Builder UI** on `/app/reports`
  (`ExecutiveReportBuilder`): window picker, section toggles, optional
  framing note (≤600 chars), prefs in localStorage (queue-saved-filters
  posture). Live agencies only.

## Semantics worth knowing before touching it

- **`statutoryDueAt` is the EFFECTIVE deadline.** Taking a statutory
  extension rewrites it (`requestService.extendDeadline`), with the
  pre-extension date preserved in the audit trail. "On time" in this report
  (and the annual report) means closed by the deadline *including* any
  lawful extension. There is no second deadline field in the port model —
  the schema's `extended_due_at` column is unread.
- **Backlog/overdue are measured at the window's END**, not at generation
  time — a report for July says what July's close looked like, whenever it
  is generated.
- **Extensions are counted by the date they were taken** (from
  `extensionHistory[].at`), not by the request's receipt date.
- **Exemptions ride the CLOSED-in-period requests** and count requests, not
  documents (same rule as the annual report, same shared code).
- **Department activity is a dispatch cohort.** Tasks dispatched in the
  window, followed to their *current* state — task completion is not
  separately timestamped, and the basis string says so rather than
  pretending. `TaskEntity` gained an optional `createdAt` for this (both
  adapters + conformance test); in-memory rows created without it are
  excluded from windows, never guessed.
- **`archive_miss` is never ROI** (house rule) — excluded from deflection
  counts and hours *inside* `computeExecutiveSummary`, pinned by test, so
  no caller has to remember.
- **Quiet periods render honest empty states** ("No requests with a
  computed deadline were closed in this period."), never suppressed
  sections — a day-window report is legitimately sparse.
- The **statute-review honesty line** (annual-report convention) prints in
  the masthead either way: reviewed-by-counsel or not-yet.

## Not in v1, on purpose

- **No schedule, no stored artifacts, no delivery** — owner cut scheduling;
  regeneration is deterministic. If cadence ever returns, the sweep's
  self-gating idiom (B2 weekly) is the shape, and a generated-report admin
  event + blob is the storage story.
- **No AI narrative yet.** The numbers layer stands alone. A narrative
  pass would be a versioned prompt + pipeline (eval-gated) whose input is
  ONLY the computed summary — never request text — rendered as an
  AI-labeled draft the clerk approves (invariant 10; AI proposes, staff
  disposes), with a deterministic template fallback.
- **No cross-agency benchmarking.** "Faster than comparable agencies" is
  invariant 11 territory (network plays); this report is self-referential.
- **No SLA-flavored copy.** History is stated as history; the only
  obligation ever stated is the statutory due date (owner's no-promise
  rule).
- **Saved templates** demoted to a future slice — with no schedule they are
  just remembered preferences, which localStorage already covers.
- **Custom date ranges** (arbitrary start/end) — day/week/month covers the
  ask; a range picker is a small additive change to `reportPeriod` callers
  if wanted.
