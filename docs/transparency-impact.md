# Transparency impact — the north-star metric, on the page

Shipped 2026-08-14 (big-ticket board §6, first slice). The homepage
promises "Fewer requests."; this makes that the measured product: one
section on /app/reports showing what demand exists, what publishing has
deflected, and what publishing NEXT would be worth — in staff-hours, with
the arithmetic printed.

## What it shows

- **Totals**: staff-hours avoided (all time), requests deflected, records
  in the public archive. Deflection math is the existing house math —
  `archive_miss` is demand signal and NEVER counts toward ROI.
- **The north-star chart**: last 6 calendar months, requests filed (top
  bar) vs. requests deflected (bottom bar), with records-published and
  archive-miss counts per month. The goal stated in the caption: the
  bottom bar growing at the top bar's expense.
- **"What publishing next would be worth"**: the disclosure librarian's
  demand patterns (docs/agentic-horizon.md B1), each with a conservative
  projection and a `basis` string in the computeDueDate idiom — every
  number checkable against the request log.

## The projection rule (deliberately conservative)

Only clustered REQUESTS are monetized, at the citation-answer rate
(1.0h — `answered_by_link` in deflectionService), not the full-production
rate (1.5h). Searches and misses are cited as further demand but never
monetized: a resident who searched, missed, and filed already counts once
as a request — no double counting. Publishing stays a named human's
per-record call; the numbers only make the case.

## Mechanics

- `src/domain/transparencyImpact.ts` (pure, tested): `monthlyImpact`
  (calendar-month buckets, archive_miss excluded from ROI columns),
  `projectOpportunities` (projection + basis), and `demandSignalsFrom` —
  the ONE demand-signal builder, extracted from the command center's
  inline code so the disclosure card and the impact section can never
  diverge on what counts as demand.
- `src/services/transparencyImpactService.ts`: the reports page's loader
  (requests + deflections + public docs). Live agencies only — the
  unseeded demo fixture has no deflection history.
- "Records published" buckets by document creation — the platform doesn't
  timestamp classification flips separately; the copy stays honest about
  it. No migration, no env vars, no model calls.

## Next slices (when wanted)

- The same numbers on the PUBLIC transparency page (the roadmapped
  per-agency compliance page — trust compounds deflection).
- Requests-per-resident normalization once agencies carry a population
  field.
- Publication annotations tied to specific opportunity acceptances, once
  the librarian's proposals get an accept event to join on.
