import Link from "next/link";
import { notFound } from "next/navigation";
import { branding } from "@/config/branding";
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
          </nav>
        </div>
      </div>

      <main id="main">
        <div className="wrap" style={{ maxWidth: 640, paddingBlock: "48px 64px" }}>
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
