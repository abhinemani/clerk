import Link from "next/link";
import { branding } from "@/config/branding";
import { BrandLockup } from "../_components/ui";
import { DemoRequestForm } from "../_components/DemoRequestForm";
import { stateProfiles } from "@/statute/profiles";

export const dynamic = "force-dynamic";

/**
 * "Book a walkthrough" — the marketing site's second call to action, paired
 * with /signup (create your records office). Signup is the door for offices
 * ready to move today; this is the door for the ones that need to see it with
 * a person first, which in government is most of them.
 *
 * SELF-CONTAINED FIRST: the built-in availability form is the default path and
 * needs no account, key, or service. A deployment that already has a booking
 * page sets DEMO_SCHEDULING_URL and it appears above the form as the faster
 * option — never as the only one.
 */
export default function DemoPage() {
  const schedulingUrl = process.env.DEMO_SCHEDULING_URL;
  const states = Object.values(stateProfiles).map((p) => ({
    code: p.stateCode,
    name: p.stateName,
  }));

  return (
    <>
      {/* .mk-topnav earns the marketing nav's ≤640px rules — chiefly the
          collapse to the mark-only crop. Without it a phone renders the full
          lockup at nav height and the wordmark smears (public/brand/README). */}
      <div className="nav mk-topnav" style={{ position: "static" }}>
        <div className="wrap nav-inner">
          <Link href="/" className="brand" aria-label={branding.productName}>
            <BrandLockup size={29} />
          </Link>
          <nav className="nav-links" aria-label="Primary">
            <Link href="/riverton" className="nav-link">
              Live demo
            </Link>
            <Link href="/signup" className="btn btn-sm btn-maroon" style={{ marginLeft: 8 }}>
              Create your records office
            </Link>
          </nav>
        </div>
      </div>

      <main id="main">
        <div className="wrap" style={{ maxWidth: 720, paddingBlock: "var(--page-top) var(--page-bottom)" }}>
          <span className="eyebrow">See it on your records</span>
          <h1 className="serif" style={{ fontSize: "2rem", marginTop: 8, fontWeight: 600 }}>
            Walk through it with us
          </h1>
          <hr className="letterhead-rule" aria-hidden style={{ marginInline: 0 }} />
          <p className="muted" style={{ marginTop: 14, maxWidth: 600 }}>
            Thirty minutes, your statute, your backlog. We open a request end to end — intake,
            triage, redaction, release — and answer the counsel questions. No slides.
          </p>

          {/* External scheduler, when a deployment has one. Opt-in and
              additive: the form below is still the path that always works. */}
          {schedulingUrl && (
            <p style={{ marginTop: 22 }}>
              <a
                className="btn btn-primary"
                href={schedulingUrl}
                target="_blank"
                rel="noreferrer noopener"
                style={{ paddingInline: 22, paddingBlock: 11 }}
              >
                Pick a time on the calendar →
              </a>
              <span className="muted" style={{ display: "block", fontSize: "0.82rem", marginTop: 10 }}>
                Or tell us your week below and we&apos;ll propose one.
              </span>
            </p>
          )}

          <div style={{ marginTop: 24 }}>
            <DemoRequestForm states={states} />
          </div>

          <p className="muted" style={{ fontSize: "0.82rem", marginTop: 18 }}>
            In a hurry? The <Link href="/riverton">live demo</Link> is open with no account, and{" "}
            <Link href="/signup">self-signup</Link> stands up a real records office in about a
            minute.
          </p>
        </div>
      </main>
    </>
  );
}
