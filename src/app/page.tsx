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
 * Copy structure (owner ask, 2026-08-13): hero → the problem → how we help →
 * ROI → how the tech works → what we're hearing → close.
 */

const PROBLEMS = [
  {
    h: "Staffing hasn't kept pace",
    d: "One person runs most records offices — often less than one, wedged between other duties. Volume keeps climbing. Headcount doesn't.",
  },
  {
    h: "AI is driving the volume up",
    d: "The tools that make government easier to reach also make it trivial to file more requests, broader ones, worded by something other than the person who wants the record. Volume stopped tracking need a while ago.",
  },
  {
    h: "Most of what's public was never published",
    d: "The record that answers the question is usually already public. It's just nowhere a resident can find it. So a search-shaped question becomes a request a person has to process.",
  },
];

const PILLARS = [
  {
    n: "01",
    t: "Deflect",
    h: "Answer before they file",
    d: "Ask in plain language. The answer box searches everything you've already released — keyword and semantic together — and hands over the document in seconds. Many requests end as a download, not a case file.",
  },
  {
    n: "02",
    t: "Fulfill",
    h: "Run every request on rails",
    d: "AI triage drafts the scope and routing. Departments respond from a no-login link or a reply-all email. The clock is computed from your state's law, and every extension records why it was granted.",
  },
  {
    n: "03",
    t: "Defend",
    h: "An audit log for counsel",
    d: "Every action — human or AI — lands in an append-only log: who, what, why. Redactions are burned into the bytes, not layered on top. Every release carries a named approver.",
  },
];

const ROI_STATS = [
  { n: "6", l: "stages every request moves through", s: "Intake, triage, search, review, redaction, correspondence. Traditionally worked by hand, one request at a time." },
  { n: "1", l: "statutory clock, computed automatically", s: "Set the moment a request is filed, straight from your state's law. Not a spreadsheet someone has to remember." },
  { n: "0", l: "cost to a resident who asks first", s: "Free and instant. A question answered from the public archive never opens a case file." },
  { n: "100%", l: "of the paper trail, kept", s: "Every suggestion, every decision, one append-only log. It caps the cost of a bad call two years from now." },
];

const STATS = [
  { n: "5", l: "state statute profiles", s: "California, Texas, Illinois, Washington, New York. Clock rules are data, not code." },
  { n: "0", l: "external services required", s: "AI, email, OCR and object storage are each opt-in behind an adapter." },
  { n: "1", l: "deployment, every agency", s: "Each with its own portal, seal, statute profile and isolated data." },
  { n: "100%", l: "of actions audit-logged", s: "Append-only, human and AI alike. No edit path, no delete path." },
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
    does: "Answers residents in plain language, from everything you've already released — keyword and semantic search together, linked straight to the documents.",
    human: "Draws only on records already public. It cannot see anything else.",
  },
  {
    stage: "At intake",
    name: "Triage",
    does: "Drafts the scope, estimates complexity, suggests which departments respond, and flags likely duplicates.",
    human: "A coordinator accepts, edits, or discards the scope before anything moves.",
  },
  {
    stage: "As records arrive",
    name: "Document review",
    does: "Suggests a classification for each document and flags passages that may fall under a statutory exemption, citation included.",
    human: "Suggestions land as cards. Staff accept, edit, or dismiss each one.",
  },
  {
    stage: "In the redaction studio",
    name: "Redaction assist",
    does: "Runs a PII pass and proposes redactions span by span. Finalizing burns them into regenerated bytes — never an overlay.",
    human: "Every span is human-confirmed; a leak check verifies the final artifact.",
  },
  {
    stage: "In correspondence",
    name: "Drafting",
    does: "Drafts clarifications, extension notices, response letters, and denials with the appeal language your statute requires.",
    human: "Letters go out under a staff name only after a staff member sends them.",
  },
  {
    stage: "Alongside your team",
    name: "The copilot & deadline watch",
    does: "Answers coordinators' questions about any request. A nightly sweep watches every clock and digests what's at risk.",
    human: "Every consultation is itself an audit event. Clock math is statute data, not model output.",
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
                FOIA should be easier.
                <br />
                <span className="mk-accent">For everyone who touches a request.</span>
              </h1>
              <hr className="letterhead-rule" aria-hidden />
              <p className="mk-lede">
                A resident wants a document, not a case number. A one-person office wants one less
                thing to track by hand. Counsel wants a decision they can defend two years later.
                None of that happens by itself today — most of it still runs on paper and memory.{" "}
                {branding.productName} runs it instead: triage, routing, records gathered, response
                drafted, the statutory deadline computed the moment a request is filed. A named
                human signs off before anything goes out.
              </p>
              <div style={{ display: "flex", gap: 12, marginTop: 32, flexWrap: "wrap" }}>
                <Link href="/signup" className="btn btn-gold" style={{ paddingInline: 24, paddingBlock: 12 }}>
                  Create your records office
                </Link>
                <Link href="/riverton" className="btn" style={{ paddingInline: 24, paddingBlock: 12 }}>
                  Explore the live demo
                </Link>
              </div>
            </div>

            {/* The thesis, made concrete: a resident asks, the assistant
                answers — from the public archive first, a drafted request
                only when the record isn't public yet. role=img with a
                description: the bubbles are an illustration, not controls,
                so assistive tech gets the summary instead of fake widgets. */}
            <div>
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
                    <p>
                      Yes — three inspection reports for 400 Main St are already public. No request
                      needed:
                    </p>
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
                    <p>That record isn&apos;t published yet, so I&apos;ve drafted a request for you:</p>
                    <div className="mk-chat-record">
                      &ldquo;Police incident report, June 2025 vehicle damage at 400 Main St.&rdquo;
                      <em>Filed as PR-2026-00184 · response due Mar 14, per Cal. Gov. Code § 7922.535</em>
                    </div>
                  </div>
                </div>
                <div className="mk-chat-foot">
                  Every answer cites the public archive. Every filed request arrives triaged, and a{" "}
                  <strong>named human</strong> decides what goes out.
                </div>
              </div>
              <p className="mk-panel-note">
                Residents get answers in seconds. Staff get requests that arrive already organized.
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
              <h2 className="mk-h2">
                Public records offices are being asked to do more, with less, mostly by hand.
              </h2>
              <p className="mk-sub">
                None of this is a staffing failure in any one office. It&apos;s three trends landing
                on the same desk at once.
              </p>
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
              <h2 className="mk-h2">One system, three jobs your office is short-staffed for.</h2>
              <p className="mk-sub">
                Most records software only handles the middle job. The requests you never receive, and
                the decisions you defend years later — that&apos;s where the real cost lives.
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
                Every AI output is a reviewable draft — an Accept / Edit / Dismiss card in front of a
                named human. Nothing legally significant leaves the building on model authority. The
                audit log reads like a defense exhibit, not a liability.
              </p>
              <hr className="letterhead-rule" aria-hidden style={{ marginInline: "auto" }} />
            </div>
          </div>
        </section>

        {/* Section 3 — ROI. What a request costs isn't just the letter you
            write back; it's staff hours, a clock that runs regardless, and
            the risk of a decision nobody can reconstruct later. */}
        <section className="mk-band-plum">
          <div className="wrap mk-section">
            <div className="mk-head">
              <span className="mk-eyebrow" style={{ color: "var(--accent)" }}>
                What it costs
              </span>
              <h2 className="mk-h2">A request is never just the letter that comes back.</h2>
              <p className="mk-sub">
                It&apos;s staff hours pulled off other duties. A clock that runs whether or not
                anyone&apos;s free to work on it. And if something&apos;s missed, a decision someone
                has to defend later. That&apos;s what {branding.productName} takes off your desk.
              </p>
            </div>
            <div className="mk-stats mk-reveal">
              {ROI_STATS.map((s) => (
                <div key={s.n} className="mk-stat">
                  <div className="mk-stat-n">{s.n}</div>
                  <div className="mk-stat-l">{s.l}</div>
                  <div className="mk-stat-sub">{s.s}</div>
                </div>
              ))}
            </div>
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
                {branding.productName} puts an AI worker at each stage of the request lifecycle. Each
                one drafts. A named staffer decides. Here&apos;s the whole roster — no fine print.
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
              Every AI action logs to the same append-only record as human actions: model, prompt
              version, outcome. No AI key configured? {branding.productName} still runs — the workers
              stand down, the workflow doesn&apos;t.
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
                Each government gets its own portal at its own address: its seal, its statute
                profile, its staff, its residents. Tenancy is enforced in the data layer on every
                query. Statute logic is data — California&apos;s 10-day clock, Washington&apos;s
                5-business-day response, New York&apos;s FOIL — configured, not coded.
              </p>
            </div>
            <div className="mk-trio mk-reveal">
              {[
                {
                  h: "Its own address",
                  d: "Every agency lives at its own path, with its own seal, accent color, and contact block. Residents never see another jurisdiction's branding.",
                },
                {
                  h: "Its own clock",
                  d: "The statute profile sets business days, observed holidays, and which extension reasons are allowed. Change states and the math changes with it — no code edit, no redeploy.",
                },
                {
                  h: "Its own data",
                  d: "Tenancy is enforced at the data layer on every query, not by a filter someone remembered to add. A conformance suite runs the same assertions against both storage adapters.",
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
              <span className="mk-eyebrow">Start where it is cheapest to start</span>
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
