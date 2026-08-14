import Link from "next/link";
import { branding } from "@/config/branding";
import { BrandLockup, BrandMarkRaster, SparkIcon } from "./_components/ui";

/**
 * The marketing site — Brandeis the product, pitched to governments. Distinct
 * from the tenant portals it links to: /riverton is the living demo.
 *
 * Design: copy-forward, with rhythm carried by alternating grounds rather
 * than by imagery. All texture is CSS (see the MARKETING SITE block in
 * globals.css). The only binary assets are the owner's approved lockup —
 * two revisions, one per theme, in the footer. Raster, so each appears once
 * and large; see public/brand/README.md for why neither can be the chrome
 * logo.
 *
 * Every number and claim on this page is checkable against the codebase —
 * no invented customer counts. The one deliberate exception is TESTIMONIALS:
 * the product has no public users yet, so those are labeled as illustrative
 * (owner ask, 2026-08-13) rather than passed off as real quotes. Swap them
 * for the real thing the moment there is a real thing.
 *
 * Copy structure (owner redesign, 2026-08-14): hero → the problem → how we
 * help → the agent era (MCP + verification + the measured north star) →
 * how the tech works → tenancy → what we're hearing → close. The agent-era
 * band replaced the abstract ROI stats: the three shipped differentiators
 * (docs/requester-api.md, docs/release-verification.md,
 * docs/transparency-impact.md) make the cost argument concretely now.
 */

const PROBLEMS = [
  {
    h: "Staffing hasn't kept pace",
    d: "Most offices are one person, wedged between other duties. Volume climbs. Headcount doesn't.",
  },
  {
    h: "AI is driving the volume up",
    d: "Request tools now write the requests — more, broader, tireless. Volume stopped tracking need.",
  },
  {
    h: "Most of what's public was never published",
    d: "The answer is usually already public — just nowhere a resident can find it. So a question becomes a case number.",
  },
];

const PILLARS = [
  {
    n: "01",
    t: "Deflect",
    h: "Answer before they file",
    d: "Plain-language search over everything you've released — and a report of the requests it prevented, in staff-hours.",
  },
  {
    n: "02",
    t: "Fulfill",
    h: "Run every request on rails",
    d: "Triage drafts scope and routing at intake. Departments answer from a no-login link. The clock comes from your state's law.",
  },
  {
    n: "03",
    t: "Defend",
    h: "An audit log for counsel",
    d: "Every action lands in an append-only log. Redactions burn into the bytes. Every release carries a named approver — and a fingerprint anyone can verify.",
  },
];

/* The agent-era proofs — each panel is a MINIATURE OF THE REAL SURFACE
   (owner, 2026-08-14: "use the look and feels"), the way the hero renders
   the answer box. The verification panel mirrors the live demo's actual
   seeded release — filename, request, and fingerprint prefix are checkable
   on /riverton/authenticity; the MCP exchange reuses the hero's PR-2026-00184
   scenario; the bars are the reports page's chart shape, illustrative. */

const STATS = [
  { n: "5", l: "state statute profiles", s: "Clock rules are data, not code." },
  { n: "0", l: "external services required", s: "AI, email, OCR, storage — all opt-in." },
  { n: "1", l: "deployment, every agency", s: "Own portal, seal, statute, data." },
  { n: "100%", l: "of actions audit-logged", s: "Human and AI alike. No edit path." },
];

const TESTIMONIALS = [
  {
    q: "The backlog doesn't come from bad intentions. It comes from one person doing five jobs. Anything that gives me back an hour a day matters.",
    by: "City Clerk, small city",
  },
  {
    q: "We used to get the same records question ten different ways. Now half of it never turns into a request at all.",
    by: "Public Records Officer, county government",
  },
  {
    q: "I don't need the AI to be right. I need it to be reviewable. That's the whole difference.",
    by: "City Attorney / records counsel",
  },
];

const AGENTS = [
  {
    stage: "Before a request exists",
    name: "The answer box",
    does: "Answers residents from everything already released, linked straight to the documents.",
    human: "Sees only public records. Nothing else.",
  },
  {
    stage: "At intake",
    name: "Triage",
    does: "Drafts scope, complexity, routing, and duplicate flags the moment a request lands.",
    human: "A coordinator accepts, edits, or discards.",
  },
  {
    stage: "As records arrive",
    name: "Document review",
    does: "Suggests a classification and flags exemption passages, citation included.",
    human: "Cards: accept, edit, or dismiss.",
  },
  {
    stage: "In the redaction studio",
    name: "Redaction assist",
    does: "Proposes redactions span by span; finalizing burns them into fresh bytes — never an overlay.",
    human: "Every span human-confirmed. A leak check verifies.",
  },
  {
    stage: "In correspondence",
    name: "Drafting",
    does: "Clarifications, extensions, response letters, denials — with your statute's appeal language.",
    human: "Sent only by a staff member, under their name.",
  },
  {
    stage: "Alongside your team",
    name: "The copilot & deadline watch",
    does: "Answers questions about any request; a nightly sweep watches every clock.",
    human: "Every consultation is itself an audit event.",
  },
  {
    stage: "After the release",
    name: "The disclosure librarian",
    does: "Mines repeated demand — requests, searches, misses — and points at what to publish next.",
    human: "Publishing stays a named human's per-record call.",
  },
  {
    stage: "If a denial is appealed",
    name: "The appeal packet builder",
    does: "Assembles counsel's dossier straight from the audit log — timeline, deadlines, exemptions, checksums.",
    human: "Drafted for counsel's review. It never sends itself.",
  },
];

export default function MarketingHome() {
  return (
    <div className="mk-page">
      {/* Product header — sticky glass, same .nav as the portals.
          Full lockup: approved mark + wordmark + tagline, all from branding.ts. */}
      <div className="nav mk-topnav">
        <div className="wrap nav-inner">
          <Link href="/" className="brand" aria-label={branding.productName}>
            {/* 29 = 36 shrunk 20% (owner ask, 2026-08-13). --nav-h is fixed by
                .nav:has(.brand-lockup) in globals.css, not derived from this
                number, so the bar itself doesn't move — only the artwork. */}
            <BrandLockup size={29} />
          </Link>
          <nav className="nav-links" aria-label="Primary">
            <Link href="/riverton" className="nav-link">
              Live demo
            </Link>
            <Link href="/admin" className="nav-link">
              Platform console
            </Link>
            <Link href="/signup" className="btn btn-sm btn-maroon" style={{ marginLeft: 8 }}>
              Create your records office
            </Link>
          </nav>
        </div>
      </div>

      <main id="main">
        {/* Hero — light civic paper (owner directive 2026-08-13: the dark hero
            read as severe; the dark ground now belongs to the nav and the
            mid-page band only). */}
        <section className="mk-hero">
          <div className="wrap">
            <div className="mk-hero-grid">
            <div className="mk-hero-inner">
              <span className="mk-eyebrow">
                For city clerks, county counsel, and records officers
              </span>
              <h1 className="mk-display">
                Fewer requests. Faster responses.
                <br />
                <span className="mk-accent">Decisions you can defend.</span>
              </h1>
              <hr className="letterhead-rule" aria-hidden />
              <p className="mk-lede">
                Most requests ask for something that&apos;s already public. {branding.productName}{" "}
                answers those instantly, straight from your archive. The rest arrive triaged,
                routed, and on the statutory clock — every AI draft waiting on a named human.
              </p>
              <div style={{ display: "flex", gap: 12, marginTop: 32, flexWrap: "wrap" }}>
                <Link href="/signup" className="btn btn-gold" style={{ paddingInline: 24, paddingBlock: 12 }}>
                  Create your records office
                </Link>
                <Link href="/riverton" className="btn" style={{ paddingInline: 24, paddingBlock: 12 }}>
                  Explore the live demo
                </Link>
              </div>
              {/* Proof row — anchors the column's foot (the old centered layout
                  left this corner empty). Same checkable claims as the
                  under-the-hood strip; a hero states them first, smaller. */}
              <div className="mk-hero-proof" aria-label="Product facts">
                {[
                  ["5", "state statute profiles — data, not code"],
                  ["100%", "of actions audit-logged, human and AI"],
                  ["0", "external services required to run"],
                ].map(([n, l]) => (
                  <div key={l}>
                    <div className="n">{n}</div>
                    <div className="l">{l}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* The thesis, made concrete: a resident asks, the assistant
                answers — from the public archive first, a drafted request
                only when the record isn't public yet. role=img with a
                description: the bubbles are an illustration, not controls,
                so assistive tech gets the summary instead of fake widgets. */}
            <div>
              <div className="mk-chat-wrap">
              <div
                className="mk-chat"
                role="img"
                aria-label="Illustration of the records assistant: a resident asks for inspection reports for 400 Main Street and instantly receives three already-public records to download. They then ask for an incident report that is not public, and the assistant files a drafted request on their behalf with the statutory response date computed from state law."
              >
                <div className="mk-chat-head">
                  <span className="mk-chat-title">City of Riverton · Public records</span>
                  <span className="mk-chat-live">Answers from the public archive</span>
                </div>
                <div className="mk-chat-body">
                  <div className="mk-msg mk-msg-user">
                    Do you have building inspection reports for 400 Main Street?
                  </div>
                  <div className="mk-msg mk-msg-bot">
                    <span className="mk-msg-tag">
                      <SparkIcon />
                      {branding.productName}
                    </span>
                    <p>Yes — already public, no request needed:</p>
                    <div className="mk-chat-record">
                      Inspection report · 400 Main St
                      <em>Released June 2025 · PDF · with 2 more from 2024</em>
                    </div>
                  </div>
                  <div className="mk-msg mk-msg-user">
                    I also need the police incident report from the June 2025 vehicle damage there.
                  </div>
                  <div className="mk-msg mk-msg-bot">
                    <span className="mk-msg-tag">
                      <SparkIcon />
                      {branding.productName}
                    </span>
                    <p>Not published yet — I&apos;ve drafted a request for you:</p>
                    <div className="mk-chat-record">
                      &ldquo;Police incident report, June 2025 vehicle damage at 400 Main St.&rdquo;
                      <em>Filed as PR-2026-00184 · response due Mar 14, per Cal. Gov. Code § 7922.535</em>
                    </div>
                  </div>
                </div>
                <div className="mk-chat-foot">
                  Every answer cites the public archive; a <strong>named human</strong> decides what
                  goes out.
                </div>
              </div>
              </div>
              <p className="mk-panel-note">
                Residents get answers in seconds — and so do their AI assistants, over MCP. Staff
                get requests that arrive already organized.
              </p>
            </div>
            </div>
          </div>
        </section>

        {/* Section 1 — the problem. Tinted band so it reads as a distinct
            beat before the product shows up to answer it. */}
        <section className="mk-band-tint">
          <div className="wrap mk-section">
            <div className="mk-head">
              <span className="mk-eyebrow">The problem</span>
              <h2 className="mk-h2">More requests. The same one person. Still by hand.</h2>
              <p className="mk-sub">Three trends, one desk.</p>
            </div>
            <div className="mk-trio mk-reveal">
              {PROBLEMS.map((p) => (
                <div key={p.h}>
                  <div className="mk-trio-rule" />
                  <h3>{p.h}</h3>
                  <p>{p.d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Section 2 — how we help. The claim comes first, the pillars carry it. */}
        <section className="mk-band-accent">
          <div className="wrap mk-section">
            <div className="mk-head">
              <span className="mk-eyebrow" style={{ color: "var(--accent)" }}>
                How we help
              </span>
              <h2 className="mk-h2">Three jobs. One system. No new headcount.</h2>
              <p className="mk-sub">
                Most records software does only the middle one.
              </p>
            </div>
            <div className="mk-pillars">
              {PILLARS.map((p) => (
                <article key={p.t} className="mk-pillar mk-reveal">
                  <span className="mk-pillar-n">{p.n}</span>
                  <span className="smallcaps" style={{ color: "var(--accent)", marginLeft: 10, fontSize: "0.85rem" }}>
                    {p.t}
                  </span>
                  <h3>{p.h}</h3>
                  <div className="mk-pillar-rule" />
                  <p>{p.d}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* The operating principle — a letterhead moment on the page's own
            paper. It used to be a near-black band; the dark ground now
            belongs to the closing CTA alone, so the page keeps exactly one
            dark moment before the footer. */}
        <section className="mk-quote-band">
          <div className="wrap mk-section">
            <div className="mk-quote mk-reveal">
              <div className="mk-quote-mark" aria-hidden>
                &ldquo;
              </div>
              <p className="mk-quote-t">AI proposes. Staff disposes.</p>
              <p className="mk-quote-b">
                Every AI output is a draft on a card — Accept, Edit, or Dismiss — in front of a
                named human. Nothing legally significant leaves the building on model authority. Two
                years later, the log reads like a defense exhibit.
              </p>
              <hr className="letterhead-rule" aria-hidden style={{ marginInline: "auto" }} />
            </div>
          </div>
        </section>

        {/* Section 3 — the agent era (redesign, 2026-08-14). The problem
            section says AI is driving volume UP; this is the answer: the
            platform stands on both sides of the machine-filed future. Every
            claim here shipped — the closing line points at the live
            endpoint so a skeptic can check from their terminal. */}
        <section className="mk-band-plum">
          <div className="wrap mk-section">
            <div className="mk-head">
              <span className="mk-eyebrow" style={{ color: "var(--accent)" }}>
                The agent era
              </span>
              <h2 className="mk-h2">Machine-filed requests are coming. Be on both sides.</h2>
              <p className="mk-sub">
                The platform that absorbs AI-written requests also serves your records to
                residents&apos; AI assistants — safely.
              </p>
            </div>
            <div className="mk-proofs mk-reveal">
              {/* 1 — the requester MCP server, as a tool exchange. */}
              <div
                className="mk-proof"
                role="img"
                aria-label="Illustration of the MCP endpoint: an AI assistant calls the search_records tool for towing contracts and receives three public records with download links, then calls file_request and receives tracking number PR-2026-00184 with the statutory due date."
              >
                <div className="mk-proof-head">Your portal speaks MCP</div>
                <div className="mk-proof-body">
                  <div className="mk-proof-call">
                    <b>→ tools/call</b> search_records &#123;&quot;query&quot;: &quot;towing
                    contracts&quot;&#125;
                  </div>
                  <div className="mk-proof-result">
                    3 public records · download links included
                    <em>Same public-records-only door as the portal</em>
                  </div>
                  <div className="mk-proof-call">
                    <b>→ tools/call</b> file_request &#123;&quot;description&quot;: &quot;police
                    incident report…&quot;&#125;
                  </div>
                  <div className="mk-proof-result">
                    Filed as PR-2026-00184
                    <em>Response due Mar 14, per Cal. Gov. Code § 7922.535</em>
                  </div>
                </div>
                <div className="mk-proof-caption">
                  Residents&apos; and newsrooms&apos; AI assistants search, check status, and file —
                  never seeing more than the portal shows anyone.
                </div>
              </div>

              {/* 2 — release verification: the authenticity page's verified
                  card, mirroring the live demo's actual seeded release. */}
              <div
                className="mk-proof"
                role="img"
                aria-label="Illustration of release verification: a file fingerprinted in the browser is confirmed byte-identical to janitorial-contract-2025.pdf, released under request PR-2026-00002, with its SHA-256 fingerprint shown."
              >
                <div className="mk-proof-head">Releases anyone can verify</div>
                <div className="mk-proof-body">
                  <div className="mk-proof-verified">
                    <strong>✓ Authentic release</strong>
                    <br />
                    Byte-identical to <span className="mono">janitorial-contract-2025.pdf</span>,
                    released under <span className="mono">PR-2026-00002</span>.
                  </div>
                  <div className="mk-proof-fingerprint">sha-256 3471666bd1131958…145f84</div>
                  <div className="mk-proof-result" style={{ borderLeftColor: "var(--gold)" }}>
                    Register of public releases
                    <em>Every published release, with its fingerprint — updated live</em>
                  </div>
                </div>
                <div className="mk-proof-caption">
                  Every release is fingerprinted at approval; a court or a newsroom verifies the
                  file in the browser — it never uploads.
                </div>
              </div>

              {/* 3 — the north star: the reports page's chart, postcard-size.
                  Bar widths are illustrative; the crossover is the point. */}
              <div
                className="mk-proof"
                role="img"
                aria-label="Illustration of the transparency report: three months of paired bars where requests filed shrink while requests deflected grow, with a projection pill reading approximately 3 staff-hours per quarter for publishing the towing series."
              >
                <div className="mk-proof-head">Fewer requests, measured</div>
                <div className="mk-proof-body">
                  <div className="mk-proof-bars">
                    {[
                      { m: "Jun", req: 88, def: 16 },
                      { m: "Jul", req: 66, def: 38 },
                      { m: "Aug", req: 46, def: 62 },
                    ].map((r) => (
                      <div key={r.m} className="mk-proof-bar-row">
                        <span className="mono">{r.m}</span>
                        <div className="mk-proof-bar-pair">
                          <div className="mk-proof-bar mk-proof-bar-req">
                            <span style={{ width: `${r.req}%` }} />
                          </div>
                          <div className="mk-proof-bar mk-proof-bar-def">
                            <span style={{ width: `${r.def}%` }} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <span className="mk-proof-pill">≈ 3h / quarter · publish the towing series</span>
                  <div className="mk-proof-fingerprint">
                    3 similar requests × 1.0 staff-hour per citation answer — the math prints with
                    the number
                  </div>
                </div>
                <div className="mk-proof-caption">
                  One report: requests filed vs. deflected, and what publishing next would be worth
                  — every number traced to the request log.
                </div>
              </div>
            </div>
            <p className="mk-sub" style={{ marginTop: 30 }}>
              Try it now: point any MCP client at{" "}
              <span className="mono">/api/v1/riverton/mcp</span> on the live demo.
            </p>
          </div>
        </section>

        {/* Section 4 — how the tech works. Proof strip, then the roster, then
            the tenancy/statute mechanics underneath both. */}
        <section className="mk-band-ai">
          <div className="wrap mk-section">
            <div className="mk-head-center">
              <span className="mk-eyebrow" style={{ color: "var(--ai)" }}>
                Under the hood
              </span>
              <h2 className="mk-h2">How the tech works</h2>
              <p className="mk-sub">
                An AI worker at every stage. Each one drafts; a named staffer decides.
              </p>
            </div>
            <div className="mk-stats mk-reveal" style={{ marginTop: 44, marginBottom: 44 }}>
              {STATS.map((s) => (
                <div key={s.n} className="mk-stat">
                  <div className="mk-stat-n">{s.n}</div>
                  <div className="mk-stat-l">{s.l}</div>
                  <div className="mk-stat-sub">{s.s}</div>
                </div>
              ))}
            </div>
            <div className="mk-roster">
              {AGENTS.map((a, i) => (
                <article key={a.name} className="mk-agent mk-reveal">
                  <span className="mk-agent-num" aria-hidden>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="mk-agent-stage">{a.stage}</span>
                  <h3>
                    <SparkIcon />
                    {a.name}
                  </h3>
                  <p>{a.does}</p>
                  <p className="mk-agent-human">{a.human}</p>
                </article>
              ))}
            </div>
            <p className="mk-sub" style={{ textAlign: "center", maxWidth: 680, marginInline: "auto", marginTop: 26 }}>
              Every AI action logs model, prompt version, and outcome. No AI key?{" "}
              {branding.productName} still runs.
            </p>
          </div>
        </section>

        {/* Multi-tenancy + statute */}
        <section className="mk-band-tint">
          <div className="wrap mk-section">
            <div className="mk-head-center">
              <BrandMarkRaster size={40} />
              <h2 className="mk-h2" style={{ marginTop: 16 }}>
                One platform. Every agency its own house.
              </h2>
              <p className="mk-sub">
                Its own portal, seal, statute profile, staff, and residents — tenancy enforced in
                the data layer, statute logic configured, not coded.
              </p>
            </div>
            <div className="mk-trio mk-reveal">
              {[
                {
                  h: "Its own address",
                  d: "Own path, seal, accent, and contact block. Residents never see another jurisdiction.",
                },
                {
                  h: "Its own clock",
                  d: "Business days, holidays, extensions — change states and the math follows. No redeploy.",
                },
                {
                  h: "Its own data",
                  d: "Isolation enforced on every query, proven by a conformance suite.",
                },
              ].map((c) => (
                <div key={c.h}>
                  <div className="mk-trio-rule" />
                  <h3>{c.h}</h3>
                  <p>{c.d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Section 5 — what we're hearing. Labeled illustrative: the product
            has no public customers yet, so nothing here is presented as a
            real quote. Swap for the real thing once there is a real thing. */}
        <section className="mk-band-tint">
          <div className="wrap mk-section">
            <div className="mk-head-center">
              <span className="mk-eyebrow" style={{ color: "var(--accent)" }}>
                What we&apos;re hearing
              </span>
              <h2 className="mk-h2">The conversations that shaped this</h2>
              <p className="mk-sub">
                Illustrative — drawn from conversations with records offices during development, not
                customer quotes yet. Real ones replace these as they come in.
              </p>
            </div>
            <div className="mk-testimonials mk-reveal">
              {TESTIMONIALS.map((t) => (
                <article key={t.by} className="mk-testimonial">
                  <div className="mk-testimonial-mark" aria-hidden>
                    &ldquo;
                  </div>
                  <p>{t.q}</p>
                  <span className="mk-testimonial-by">{t.by}</span>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Closing CTA */}
        <section className="mk-band-dark">
          <div className="wrap mk-section">
            <div className="mk-cta">
              <span className="mk-eyebrow">An afternoon, not a procurement</span>
              <h2 className="mk-h2" style={{ marginTop: 14 }}>
                Stand up a records office in an afternoon.
              </h2>
              <p className="mk-sub" style={{ marginInline: "auto", maxWidth: 560 }}>
                Self-signup is open to government email addresses. Bring your state, your
                departments, and your seal — the checklist does the rest.
              </p>
              <div className="mk-cta-row">
                <Link href="/signup" className="btn btn-gold" style={{ paddingInline: 24, paddingBlock: 12 }}>
                  Create your records office
                </Link>
                <Link href="/riverton" className="btn btn-outline-light" style={{ paddingInline: 24, paddingBlock: 12 }}>
                  Explore the live demo
                </Link>
              </div>
              <p className="mk-note" style={{ marginTop: 16 }}>
                Prefer a guided look?{" "}
                <a href={`mailto:hello@brandeis.us?subject=${encodeURIComponent(`${branding.productName} demo`)}`}>
                  Request a walkthrough
                </a>
                .
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* Product footer */}
      <footer className="gov-footer" style={{ marginTop: 0 }}>
        <div className="wrap">
          {/* Dark rev, PINNED — not swapped. The footer's ground is
              --primary-deep, which is dark in BOTH themes, so keying the swap
              off prefers-color-scheme put the light rev's navy wordmark on a
              near-black footer and made it disappear. Swap on the GROUND, not
              the theme. The light rev lives on /signup, whose ground follows
              the visitor. */}
          <img
            src="/brand/brandeis-lockup-dark.png"
            alt={`${branding.productName} — ${branding.tagline}`}
            style={{ width: 300, height: "auto", marginTop: 34, marginBottom: -8 }}
          />
          <div className="mk-foot">
            <div className="mk-foot-col">
              <h4>Product</h4>
              <Link href="/riverton">Live demo</Link>
              <Link href="/signup">Create your records office</Link>
              <Link href="/admin">Platform console</Link>
            </div>
            <div className="mk-foot-col">
              <h4>For residents</h4>
              <Link href="/riverton/archive">Browse released records</Link>
              <Link href="/riverton/track">Track a request</Link>
              <Link href="/riverton/log">Public request log</Link>
              <Link href="/riverton/authenticity">Verify a released document</Link>
            </div>
            <div className="mk-foot-col">
              <h4>Contact</h4>
              <a href="mailto:hello@brandeis.us">hello@brandeis.us</a>
            </div>
          </div>
          <div className="gov-footer-bottom">
            <span>
              © {new Date().getFullYear()} {branding.productName}. {branding.tagline}.
            </span>
            <span>Self-hostable. No accounts required to run it.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
