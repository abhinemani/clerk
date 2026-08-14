import Link from "next/link";
import { redirect } from "next/navigation";
import { branding } from "@/config/branding";
import { schedulingUrl } from "@/domain/demoRequest";
import { stateProfiles } from "@/statute/profiles";
import { BrandLockup } from "../_components/ui";
import { DemoRequestForm } from "../_components/DemoRequestForm";

export const dynamic = "force-dynamic";

/**
 * "Book a walkthrough" — the marketing site's primary CTA lands here.
 *
 * Self-contained by default (the built-in form writes a row; see
 * demo/actions.ts). A deployment that runs a real scheduler sets
 * DEMO_SCHEDULING_URL and this page forwards to it — the marketing CTAs link
 * straight out in that case, so this redirect only catches direct hits and
 * stale links.
 *
 * Chrome mirrors /signup rather than the marketing page: someone who has
 * decided to talk to us doesn't need to be sold again on the way to a form.
 */
export default function DemoPage() {
  const scheduler = schedulingUrl();
  if (scheduler) redirect(scheduler);

  const states = Object.values(stateProfiles).map((p) => ({
    code: p.stateCode,
    name: p.stateName,
  }));

  return (
    <>
      <div className="nav" style={{ position: "static" }}>
        <div className="wrap nav-inner">
          <Link href="/" className="brand" aria-label={branding.productName}>
            <BrandLockup size={36} />
          </Link>
          <nav className="nav-links" aria-label="Primary">
            <Link href="/riverton" className="nav-link">
              See it live
            </Link>
          </nav>
        </div>
      </div>

      <main id="main">
        <div
          className="wrap"
          style={{ maxWidth: 640, paddingBlock: "var(--page-top) var(--page-bottom)" }}
        >
          {/* Dark-locked (owner directive 2026-08-13): --paper is dark on
              every screen now, so the dark rev is the only lockup. */}
          <img
            src="/brand/brandeis-lockup-dark.png"
            alt=""
            style={{ width: 260, height: "auto", marginBottom: 26 }}
          />
          <span className="eyebrow">A working session, not a pitch</span>
          <h1 className="serif" style={{ fontSize: "2rem", marginTop: 8, fontWeight: 600 }}>
            Book a walkthrough
          </h1>
          <p className="muted" style={{ marginTop: 10, maxWidth: 540 }}>
            Thirty minutes with the people who built {branding.productName}. Bring your worst
            backlog, your state&apos;s deadline rules, and counsel&apos;s hardest question — we&apos;ll
            run them through the real product, not slides.
          </p>

          <div style={{ marginTop: 24 }}>
            <DemoRequestForm states={states} source="demo-page" />
          </div>

          <p className="muted" style={{ fontSize: "0.82rem", marginTop: 18 }}>
            Would rather just poke around? The{" "}
            <Link href="/riverton">live demo</Link> is open — a full working city, no login. Or
            skip us entirely and{" "}
            <Link href="/signup">open your own records office</Link>.
          </p>
        </div>
      </main>
    </>
  );
}
