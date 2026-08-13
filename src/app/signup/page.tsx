import Link from "next/link";
import { notFound } from "next/navigation";
import { branding } from "@/config/branding";
import { BrandLockup } from "../_components/ui";
import { stateProfiles } from "@/statute/profiles";
import { SignupForm } from "../_components/SignupForm";

export const dynamic = "force-dynamic";

/**
 * Self-service jurisdiction signup. Multi-tenant front door: any government
 * creates its own isolated tenant — portal, workspace, statute clock — and
 * lands on the go-live checklist. Operator deployments can turn this page off
 * with SELF_SIGNUP=off (the platform console remains the onboarding path).
 */
export default function SignupPage() {
  // Kill switch for operator-only deployments (the action re-checks too).
  if (process.env.SELF_SIGNUP === "off") notFound();

  const states = Object.values(stateProfiles).map((p) => ({
    code: p.stateCode,
    name: p.stateName,
  }));

  return (
    <>
      <div className="nav" style={{ position: "static" }}>
        <div className="wrap nav-inner">
          <Link href="/" className="brand" aria-label={branding.productName}>
            <BrandLockup size={36} idPrefix="su" />
          </Link>
          <nav className="nav-links" aria-label="Primary">
            <Link href="/riverton" className="nav-link">
              Live demo
            </Link>
          </nav>
        </div>
      </div>

      <main id="main">
        <div className="wrap" style={{ maxWidth: 640, paddingBlock: "48px 64px" }}>
          {/* Both revisions, swapped by theme — correct HERE because this
              ground (--paper) follows the visitor. Contrast the footer, whose
              ground is dark either way and therefore pins the dark rev. */}
          <picture>
            <source
              srcSet="/brand/brandeis-lockup-dark.png"
              media="(prefers-color-scheme: dark)"
            />
            <img
              src="/brand/brandeis-lockup-light.png"
              alt=""
              style={{ width: 260, height: "auto", marginBottom: 26 }}
            />
          </picture>
          <span className="eyebrow">Bring {branding.productName} to your jurisdiction</span>
          <h1 className="serif" style={{ fontSize: "2rem", marginTop: 8, fontWeight: 600 }}>
            Open your records office
          </h1>
          <p className="muted" style={{ marginTop: 10, maxWidth: 540 }}>
            Your own resident portal, staff workspace, and statutory clock — isolated from every
            other jurisdiction on this deployment, live in about a minute. A go-live checklist
            walks you through setup once you&apos;re in.
          </p>

          <div style={{ marginTop: 24 }}>
            <SignupForm states={states} />
          </div>

          <p className="muted" style={{ fontSize: "0.82rem", marginTop: 18 }}>
            Don&apos;t see your state? Profiles ship reviewed, statute by statute — write to the
            deployment operator and it can be added.
          </p>
        </div>
      </main>
    </>
  );
}
