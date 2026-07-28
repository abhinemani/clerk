import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { branding } from "@/config/branding";
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
  return {
    title: `${agency.name} Public Records — Office of the City Clerk`,
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

  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Nav agencyName={agency.name} agencySlug={agency.slug} stateName={stateName(agency.stateCode)} session={session} />
      <main id="main">{children}</main>

      <footer className="gov-footer">
        <div className="wrap">
          <div className="gov-footer-grid">
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                <Seal size={44} label={`Seal of the ${agency.name}`} />
                <div style={{ lineHeight: 1.2 }}>
                  <div className="serif" style={{ color: "#fff", fontWeight: 700, fontSize: "1.05rem" }}>
                    {agency.name}
                  </div>
                  <div style={{ fontSize: "0.78rem", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                    Office of the City Clerk
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
                <li>
                  <Link href={`/${agency.slug}/app`}>Staff workspace</Link>
                </li>
              </ul>
            </div>

            <div>
              <div className="gov-footer-title">Records office</div>
              <ul>
                <li>City Hall, 100 Civic Center Plaza</li>
                <li>Mon–Fri, 8:00 a.m.–5:00 p.m.</li>
                <li>
                  <a href={`mailto:records@${agency.slug}.gov`}>records@{agency.slug}.gov</a>
                </li>
              </ul>
            </div>
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
    </>
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
