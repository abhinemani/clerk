import Link from "next/link";
import { branding } from "@/config/branding";
import { Seal, SparkIcon } from "./_components/ui";

/**
 * The marketing site — Holmes the product, pitched to governments. Distinct
 * from the tenant portals it links to: /riverton is the living demo.
 */
export default function MarketingHome() {
  return (
    <>
      {/* Product header */}
      <div className="nav" style={{ position: "static" }}>
        <div className="wrap nav-inner">
          <Link href="/" className="brand">
            <span className="brand-name">
              <span className="brand-agency">{branding.productName}</span>
              <span className="brand-dept">Public records, handled</span>
            </span>
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
        {/* Hero — the product wears the flag: deep navy, gold aurora */}
        <section className="mk-hero">
          <div className="wrap" style={{ paddingBlock: "84px 72px", textAlign: "center", maxWidth: 860 }}>
            <span className="smallcaps" style={{ fontSize: "0.95rem", color: "var(--gold)" }}>
              For city clerks, county counsel, and records officers
            </span>
            <h1 style={{ fontSize: "clamp(2.3rem, 5.5vw, 3.7rem)", marginTop: 14, fontWeight: 600, color: "#ffffff" }}>
              The AI-native public records platform
            </h1>
            <hr className="letterhead-rule" aria-hidden />
            <p style={{ fontSize: "1.18rem", marginTop: 20, maxWidth: 640, marginInline: "auto", color: "#b9c5d8" }}>
              {branding.productName} answers residents before they file, runs every request against
              its statutory clock, and leaves an audit trail your counsel will actually enjoy reading.
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 30, flexWrap: "wrap" }}>
              <Link href="/signup" className="btn btn-gold" style={{ paddingInline: 24, paddingBlock: 12 }}>
                Create your records office
              </Link>
              <Link href="/riverton" className="btn btn-outline-light" style={{ paddingInline: 24, paddingBlock: 12 }}>
                Explore the live demo
              </Link>
            </div>
            <p style={{ fontSize: "0.85rem", marginTop: 16, color: "#8fa0ba" }}>
              The demo is the real product, running for the fictional City of Riverton.
            </p>
          </div>
        </section>

        {/* Three pillars */}
        <section className="wrap" style={{ paddingBlock: "56px 8px" }}>
          <div className="mk-grid">
            {[
              {
                t: "Deflect",
                h: "Answer before they file",
                d: "A plain-language answer box searches everything you've already released. Residents get documents in seconds; your queue gets fewer, tighter requests.",
              },
              {
                t: "Fulfill",
                h: "Run every request on rails",
                d: "AI triage drafts scope and routing; departments respond from a no-login link; the statutory clock is computed from your state's law, not a spreadsheet.",
              },
              {
                t: "Defend",
                h: "An audit log for counsel",
                d: "Every action — human or AI — lands in an append-only event log with who, what, and why. Redactions burn true; releases carry a named approver.",
              },
            ].map((f) => (
              <article key={f.t} className="card card-pad" style={{ borderTop: "3px solid var(--gold)" }}>
                <span className="smallcaps" style={{ color: "var(--accent)", fontSize: "0.85rem" }}>
                  {f.t}
                </span>
                <h2 style={{ fontSize: "1.3rem", marginTop: 8 }}>{f.h}</h2>
                <p className="muted" style={{ marginTop: 8, fontSize: "0.95rem" }}>
                  {f.d}
                </p>
              </article>
            ))}
          </div>
        </section>

        {/* Principle */}
        <section className="wrap" style={{ paddingBlock: "48px 8px", maxWidth: 820 }}>
          <div className="ai-card" style={{ padding: "26px 28px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--ai)", fontWeight: 600 }}>
              <SparkIcon /> The operating principle
            </div>
            <h2 style={{ fontSize: "1.5rem", marginTop: 10 }}>AI proposes. Staff disposes.</h2>
            <p className="muted" style={{ marginTop: 10, fontSize: "1.02rem" }}>
              Every AI output in {branding.productName} is a reviewable draft — an Accept / Edit /
              Dismiss card in front of a named human. Nothing legally significant leaves the building
              on model authority. That's why the audit log reads like a defense exhibit, not a
              liability.
            </p>
          </div>
        </section>

        {/* What the AI actually does — concrete, lifecycle-ordered, honest */}
        <section className="wrap" style={{ paddingBlock: "48px 8px", maxWidth: 980 }}>
          <div style={{ textAlign: "center", maxWidth: 720, marginInline: "auto" }}>
            <span className="smallcaps" style={{ color: "var(--ai)", fontSize: "0.85rem" }}>
              Under the hood
            </span>
            <h2 style={{ fontSize: "1.6rem", marginTop: 8 }}>What the AI is doing, step by step</h2>
            <p className="muted" style={{ marginTop: 10, fontSize: "1.02rem" }}>
              {branding.productName} puts an AI worker at each stage of the request lifecycle. Each
              one drafts; a named member of your staff decides. Here is the whole roster — there is
              no fine print.
            </p>
          </div>
          <div className="mk-agents" style={{ marginTop: 28 }}>
            {[
              {
                stage: "Before a request exists",
                name: "The answer box",
                does: "Searches everything your agency has already released — keyword and semantic, together — and answers residents in plain language with links to the documents. Many requests end here, as downloads instead of paperwork.",
                human: "Draws only on records already public. It cannot see anything else.",
              },
              {
                stage: "At intake",
                name: "Triage",
                does: "Reads the new request, drafts a scope summary, estimates complexity, suggests which departments should respond, and flags likely duplicates of requests you've already handled.",
                human: "A coordinator accepts, edits, or discards the scope before anything moves.",
              },
              {
                stage: "As records arrive",
                name: "Document review",
                does: "Reads each uploaded document, suggests a classification, and marks passages that may fall under a statutory exemption — with the citation it thinks applies.",
                human: "Suggestions land as cards on the document. Staff accept, edit, or dismiss each one.",
              },
              {
                stage: "In the redaction studio",
                name: "Redaction assist",
                does: "Runs a PII pass and proposes redactions span by span. Finalizing regenerates the document from clean bytes — accepted redactions are burned in, never layered on top.",
                human: "Every span is human-confirmed, and a leak check verifies the final artifact.",
              },
              {
                stage: "In correspondence",
                name: "Drafting",
                does: "Drafts clarification replies, extension notices, response letters, and denial letters with the appeal language your statute requires — grounded in the request's actual record.",
                human: "Letters go out under a staff name only after a staff member sends them.",
              },
              {
                stage: "Alongside your team",
                name: "The copilot & deadline watch",
                does: "A coordinator can ask the copilot about any request; drafted messages are editable in place and marked as AI-assisted. A nightly sweep watches every statutory clock and writes a digest of what's at risk.",
                human: "Every consultation is itself an audit event. The clock math is statute data, not model output.",
              },
            ].map((a) => (
              <article key={a.name} className="card card-pad" style={{ borderTop: "3px solid var(--ai)" }}>
                <span className="smallcaps" style={{ color: "var(--accent)", fontSize: "0.78rem" }}>
                  {a.stage}
                </span>
                <h3 style={{ fontSize: "1.12rem", marginTop: 6, display: "flex", alignItems: "center", gap: 7 }}>
                  <span style={{ color: "var(--ai)", display: "inline-flex" }}>
                    <SparkIcon />
                  </span>
                  {a.name}
                </h3>
                <p className="muted" style={{ marginTop: 8, fontSize: "0.93rem" }}>{a.does}</p>
                <p style={{ marginTop: 10, fontSize: "0.88rem", color: "var(--ai)", fontWeight: 500 }}>
                  {a.human}
                </p>
              </article>
            ))}
          </div>
          <p className="muted" style={{ textAlign: "center", marginTop: 22, fontSize: "0.92rem", maxWidth: 680, marginInline: "auto" }}>
            Every AI action is logged to the same append-only record as human actions — model,
            prompt version, and outcome. And without an AI key configured, {branding.productName}{" "}
            still runs: the workers stand down, the workflow doesn't.
          </p>
        </section>

        {/* Multi-tenant pitch */}
        <section className="wrap" style={{ paddingBlock: "48px 8px", maxWidth: 820, textAlign: "center" }}>
          <Seal size={54} />
          <h2 style={{ fontSize: "1.6rem", marginTop: 14 }}>One platform. Every agency its own house.</h2>
          <p className="muted" style={{ marginTop: 10, fontSize: "1.02rem" }}>
            Each government gets its own portal at its own address — its seal, its statute profile,
            its staff roster, its residents. Tenancy is enforced in the data layer on every query,
            and statute logic is data: California's 10-day clock, Washington's 5-business-day
            response, New York's FOIL — configured, not coded.
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 20, flexWrap: "wrap" }}>
            <a
              href={`mailto:hello@holmes.example?subject=${encodeURIComponent(`${branding.productName} demo`)}`}
              className="btn btn-maroon"
            >
              Request a demo
            </a>
            <Link href="/riverton" className="btn">
              Or just try it →
            </Link>
          </div>
        </section>
      </main>

      {/* Product footer */}
      <footer className="gov-footer" style={{ marginTop: 64 }}>
        <div className="wrap">
          <div className="gov-footer-bottom" style={{ borderTop: "none" }}>
            <span>
              © {new Date().getFullYear()} {branding.productName}. {branding.tagline}.
            </span>
            <span>
              <a href="mailto:hello@holmes.example">hello@holmes.example</a>
            </span>
          </div>
        </div>
      </footer>

      <style>{`
        .mk-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
        @media (max-width: 820px) { .mk-grid { grid-template-columns: 1fr; } }
        .mk-agents { display: grid; grid-template-columns: repeat(2, 1fr); gap: 18px; }
        @media (max-width: 820px) { .mk-agents { grid-template-columns: 1fr; } }
      `}</style>
    </>
  );
}
