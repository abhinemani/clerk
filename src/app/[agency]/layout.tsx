import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { branding } from "@/config/branding";
import { effectiveBranding, tenantAccentCss } from "@/domain/branding";
import { getAgencyForSlug } from "@/lib/live";
import { sessionUser } from "@/auth/guards";
import { Nav } from "../_components/Nav";
import { Seal } from "../_components/ui";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ agency: string }>;
}): Promise<Metadata> {
  const { agency: slug } = await params;
  const agency = await getAgencyForSlug(slug);
  if (!agency) return {};
  const office = effectiveBranding(agency.branding).officeName;
  return {
    title: `${agency.name} Public Records — ${office}`,
    description: `Request, track, and browse public records of the ${agency.name}.`,
  };
}

/** The governmental shell every tenant portal page renders inside. */
export default async function AgencyLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ agency: string }>;
}) {
  const { agency: slug } = await params;
  const agency = await getAgencyForSlug(slug);
  if (!agency) notFound();

  const user = await sessionUser();
  const session =
    user && user.agencySlug === slug && (user.kind === "staff" || user.kind === "requester")
      ? { kind: user.kind, name: user.name ?? user.email ?? "Account" }
      : null;

  // Tenant identity: uploaded seal, contrast-guarded accent, office details
  // below. The accent used to be inline CSS variables, which are theme-blind
  // — the dark theme uses --primary as accent TEXT on near-black, where a
  // white-ink-safe (dark) accent fails AA. tenantAccentCss emits per-theme
  // values instead: stored accent in light, lightness-lifted variant in dark
  // (hue held — the same lever the brand uses for terracotta). It re-runs
  // checkAccentColor and returns null for anything invalid, so no unvetted
  // tenant string ever reaches the style element.
  const b = effectiveBranding(agency.branding);
  const sealUrl = b.hasCustomSeal ? `/${agency.slug}/seal` : null;
  const accentCss = b.accentColor ? tenantAccentCss(b.accentColor) : null;

  return (
    <div className={`agency-shell${accentCss ? " tenant-accent" : ""}`}>
      {accentCss && <style>{accentCss}</style>}
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Nav
        agencyName={agency.name}
        agencySlug={agency.slug}
        stateName={stateName(agency.stateCode)}
        session={session}
        sealUrl={sealUrl}
        officeName={b.officeName}
      />
      <main id="main">{children}</main>

      <footer className="gov-footer">
        <div className="wrap">
          <div className="gov-footer-grid">
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                {sealUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- tenant-uploaded, served by our own route
                  <img
                    src={sealUrl}
                    alt={`Seal of the ${agency.name}`}
                    width={44}
                    height={44}
                    style={{ borderRadius: "50%", objectFit: "cover" }}
                  />
                ) : (
                  <Seal size={44} label={`Seal of the ${agency.name}`} />
                )}
                <div style={{ lineHeight: 1.2 }}>
                  <div className="serif" style={{ color: "#fff", fontWeight: 700, fontSize: "1.05rem" }}>
                    {agency.name}
                  </div>
                  <div style={{ fontSize: "0.78rem", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                    {b.officeName}
                  </div>
                </div>
              </div>
              <p style={{ margin: 0, maxWidth: 380 }}>
                Records requests are processed under the public records law of the state of{" "}
                {stateName(agency.stateCode)}. Every release is reviewed and approved by a named
                member of staff.
              </p>
            </div>

            <div>
              <div className="gov-footer-title">Public records</div>
              <ul>
                <li>
                  <Link href={`/${agency.slug}/request`}>File a request</Link>
                </li>
                <li>
                  <Link href={`/${agency.slug}/track`}>Track a request</Link>
                </li>
                <li>
                  <Link href={`/${agency.slug}/archive`}>Browse released records</Link>
                </li>
                {agency.settings?.publicRequestLog === true && (
                  <li>
                    <Link href={`/${agency.slug}/log`}>Public request log</Link>
                  </li>
                )}
                <li>
                  <Link href={`/${agency.slug}/app`}>Staff workspace</Link>
                </li>
              </ul>
            </div>

            {/* Contact details render ONLY when the clerk provided them —
                a fresh tenant never shows an invented address. */}
            {(b.addressLines.length > 0 || b.hours || b.contactEmail) && (
              <div>
                <div className="gov-footer-title">Records office</div>
                <ul>
                  {b.addressLines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                  {b.hours && <li>{b.hours}</li>}
                  {b.contactEmail && (
                    <li>
                      <a href={`mailto:${b.contactEmail}`}>{b.contactEmail}</a>
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>

          <div className="gov-footer-bottom">
            <span>
              © {new Date().getFullYear()} {agency.name}. An equal-opportunity public agency.
            </span>
            <span>
              Powered by {branding.productName} — AI proposes, staff disposes; every release
              carries a named human approval.
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}

const STATE_NAMES: Record<string, string> = {
  CA: "California",
  TX: "Texas",
  IL: "Illinois",
  WA: "Washington",
  NY: "New York",
};

function stateName(code: string): string {
  return STATE_NAMES[code] ?? code;
}
