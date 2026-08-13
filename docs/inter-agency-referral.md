# Inter-agency referral — phases 2 and 3

Phase 1 shipped (commit `3aef253`). **Phase 2 shipped 2026-08-04 (commit
`1a69fa1`)** — §"Phase 2" below is kept as the as-built record; everything in it
exists. Phase 3 remains the implementable spec for the one unbuilt piece. Read
`HANDOFF.md` first for repo-wide context.

## Where phase 1 left things

| Piece | Location |
|---|---|
| `referred` request status | `src/db/schema.ts`, `src/domain/requestLifecycle.ts` |
| `agency_directory` table (incl. **unused** `peerAgencyId`) | `src/db/schema.ts`, migration `0007` |
| Directory CRUD | `Repository` port + both adapters |
| `referRequest`, `composeReferralLetter` | `src/services/referralService.ts` |
| Admin directory manager | `/[agency]/app/admin/directory` |
| Refer panel on request detail | `src/app/_components/ReferPanel.tsx` |
| Referrals counted apart from denials | `src/reporting/metrics.ts`, `annualReport.ts` |

Key decision to preserve: **a referral is not a denial.** Denying means the
agency held records and withheld them. Every new surface must keep that
distinction — it is the difference between an office that looks helpful and one
that looks secretive in its published statistics.

---

## Phase 2 — AI suggests the right agency at intake — ✅ SHIPPED 2026-08-04

**Outcome:** staff stop spending time working a request they can never fulfill,
and the resident is redirected in hours rather than after the full statutory
clock runs out.

As built (commit `1a69fa1`), matching the spec below with these specifics:
- `custodianProposals()` in the pipeline module is the reducer between raw
  model output and what staff see: "belongs to us" wins over any stray
  suggestion, unknown directory ids drop, confidence < 0.5 drops, clamped 0–1.
  The evals grade THROUGH this reducer, so they measure what ships.
- The event only writes when proposals survive ("ours" logs nothing — no noise).
- Detail page re-resolves the proposal against the live directory (entries can
  be deleted between triage and view) and passes it to `ReferPanel` as an
  `aiProposal` card: Review & refer (pre-fills target + note with the
  rationale), Refer elsewhere, Dismiss. The phase-1 Refer button remains the
  single acting control.
- Live scorecard at ship time: 8/8, 0 false referrals, 0 wrong targets, 3/3
  referrals caught.
- Gotcha discovered en route: structured outputs reject `min`/`max` on numbers
  in the JSON schema (400). `routing.ts` had them on `confidence` — the whole
  live routing pass was failing silently in the triage job's catch. Bounds now
  clamp on read everywhere (the intakeTriage convention). If you add a numeric
  field to any pipeline schema, do NOT bound it in Zod.

### Build

1. **New pipeline** `src/ai/pipelines/custodianSuggest.ts`, following the shape of
   `routing.ts` exactly (Zod schema → `zodToJsonSchema` → `PipelineDefinition`).

   ```ts
   // Input
   { interpretedScope: string; recordTypes: string[];
     agencyName: string;                 // who we are — "not ours" needs a "ours"
     directory: Array<{ id: string; name: string; recordTypes: string[]; notes?: string }> }
   // Output
   { belongsToThisAgency: boolean;
     suggestions: Array<{ directoryEntryId: string; confidence: number; rationale: string }> }
   ```

   Prompt lives in `src/ai/prompts/custodianSuggest.ts` with a
   `CUSTODIAN_SUGGEST_PROMPT_VERSION` constant. Tell the model plainly: default
   to `belongsToThisAgency: true` when unsure — wrongly referring a request the
   agency *does* hold is far worse than missing a referral, because the resident
   gets bounced for nothing.

2. **Ride the existing triage job.** In `src/jobs/triageJob.ts`, after the
   routing block, run this pipeline when the agency has directory entries.
   Store the result as an `ai_action` event with
   `payload.pipeline = "custodian_suggest"` — same pattern the routing
   suggestions already use, so the detail page can read it back.

3. **Render as a proposal card.** In the request detail page, read the latest
   `custodian_suggest` event and pass it into `ReferPanel` as a pre-selected
   target with the rationale shown. Staff still click Refer — never auto-refer.
   Auto-referring is a Tier-3 action (it reaches a requester) and would break
   invariant 4.

4. **Evals — required.** Add `evals/custodianSuggest.golden.ts` +
   `.test.ts` following `evals/exemptionPass.test.ts`. Grade **precision-first**
   here, the opposite of the exemption pass: a false referral bounces a resident
   who came to the right place. Golden cases should include several requests
   that clearly DO belong to the agency (expect `belongsToThisAgency: true`,
   zero suggestions) — that's the case that protects residents.

5. Per `CLAUDE.md`, run `npm run eval` and put the scorecard diff in the commit.

### Definition of done
Types pass, tests pass, evals include the new golden set, an AI-suggested
referral appears as an Accept/Edit/Dismiss card, and nothing auto-refers.

---

## Phase 3 — one-click forwarding between Brandeis tenants

**Outcome:** the moat. When both agencies are on Brandeis, the resident keeps a
single tracking number and never re-files. No competitor can do this because no
competitor has both agencies in one system.

### Build

1. **Link directory entries to tenants.** `peerAgencyId` already exists on
   `agency_directory` and is unused. Add a picker in the directory manager
   listing other agencies in this deployment (platform-operator scope — see the
   tenancy note below). Setting it turns "Refer" into "Refer & forward".

2. **New service** `forwardRequest` in `referralService.ts`:
   - Creates a NEW request in the target agency via the normal service layer,
     with `rawText` copied verbatim (invariant 6 — the original is evidence).
   - Copies the requester by email (dedupe via `findRequesterByEmail`), so they
     can track it there too.
   - Links the two: add `forwarded_from_request_id` (source agency id + request
     id) on the new request, and `forwarded_to_*` on the old one. **Needs a new
     migration** — do not edit `0007`.
   - Marks the source request `referred` exactly as phase 1 does.
   - Writes an event on BOTH requests. The receiving agency's trail must say
     where this came from; the sending agency's must say where it went.

3. **Cross-tenant safety — the hard part.** Every read in this repo is
   agency-scoped by `tenantWhere`, deliberately (invariant 2). Forwarding is the
   only operation that legitimately touches two tenants, so:
   - Put it behind ONE explicit service function that takes both agency ids and
     is the only place that crosses the line. Do not relax `tenantWhere`.
   - Copy only: `rawText`, requester name/email, and the public id of the source
     request. **Never** documents, internal notes, events, or staff names.
   - Add an invariant test in the tenant-isolation suite asserting that a
     forward copies nothing beyond that allow-list.

4. **Requester experience.** The tracker for the source request should show
   "Forwarded to <agency> — track it at <link>" with the new public id. If the
   requester has an account, surface both requests on their account page.

5. **Consent question — decide before building.** Forwarding a resident's name
   and email to another agency without asking may be unwelcome, and in some
   states may itself be a disclosure. Recommend: a checkbox in the Refer panel,
   defaulted OFF, "also send my contact details so they can reply directly."
   Without it, forward the request text only and tell the target agency to
   respond via the source agency. **This is a product/legal decision — ask the
   owner, don't assume.**

### Definition of done
Types pass, tests pass (including the new cross-tenant invariant test),
migration included, and a forward demonstrably creates a linked request in a
second seeded tenant (Bellmar) with nothing leaked beyond the allow-list.

---

## Suggested order

Phase 2 first — it's self-contained, needs no new tenancy reasoning, and
delivers value to every agency including single-tenant deployments. Phase 3 is
worth more but should wait until at least two real agencies are on one
deployment, because its value is zero until then and its risk (cross-tenant
data flow) is permanent.
