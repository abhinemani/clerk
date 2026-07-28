import Link from "next/link";
import { branding } from "@/config/branding";
import { Seal, SparkIcon } from "./_components/ui";

/**
 * The marketing site — Clerk the product, pitched to governments. Distinct
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
            <a href="mailto:hello@clerk.example?subject=Clerk%20demo" className="btn btn-sm btn-maroon" style={{ marginLeft: 8 }}>
              Request a demo
            </a>
          </nav>
        </div>
      </div>

      <main id="main">
        {/* Hero */}
        <section style={{ background: "linear-gradient(180deg, var(--primary-tint), var(--paper) 70%)" }}>
          <div className="wrap" style={{ paddingBlock: "76px 64px", textAlign: "center", maxWidth: 860 }}>
            <span className="smallcaps" style={{ fontSize: "0.95rem", color: "var(--maroon)" }}>
              For city clerks, county counsel, and records officers
            </span>
            <h1 style={{ fontSize: "clamp(2.3rem, 5.5vw, 3.6rem)", marginTop: 12, fontWeight: 600 }}>
              The AI-native public records platform
            </h1>
            <p className="muted" style={{ fontSize: "1.18rem", marginTop: 16, maxWidth: 620, marginInline: "auto" }}>
              {branding.productName} answers residents before they file, runs every request against
              its statutory clock, and leaves an audit trail your counsel will actually enjoy reading.
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 28, flexWrap: "wrap" }}>
              <Link href="/riverton" className="btn btn-primary" style={{ paddingInline: 22, paddingBlock: 12 }}>
                Explore the resident portal
              </Link>
              <Link href="/riverton/app" className="btn" style={{ paddingInline: 22, paddingBlock: 12 }}>
                See the staff workspace
              </Link>
            </div>
            <p className="muted" style={{ fontSize: "0.85rem", marginTop: 14 }}>
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
              <article key={f.t} className="card card-pad">
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
            <a href="mailto:hello@clerk.example?subject=Clerk%20demo" className="btn btn-maroon">
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
              <a href="mailto:hello@clerk.example">hello@clerk.example</a>
            </span>
          </div>
        </div>
      </footer>

      <style>{`
        .mk-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
        @media (max-width: 820px) { .mk-grid { grid-template-columns: 1fr; } }
      `}</style>
    </>
  );
}
