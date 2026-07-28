import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";
import { branding } from "@/config/branding";
import { DEMO_AGENCY } from "@/lib/demo";
import { Nav } from "./_components/Nav";
import { Seal } from "./_components/ui";

export const metadata: Metadata = {
  title: `${DEMO_AGENCY.name} Public Records — Office of the City Clerk`,
  description: `Request, track, and browse public records of the ${DEMO_AGENCY.name}. ${branding.tagline}.`,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <Nav />
        <main id="main">{children}</main>

        <footer className="gov-footer">
          <div className="wrap">
            <div className="gov-footer-grid">
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                  <Seal size={44} label={`Seal of the ${DEMO_AGENCY.name}`} />
                  <div style={{ lineHeight: 1.2 }}>
                    <div className="serif" style={{ color: "#fff", fontWeight: 700, fontSize: "1.05rem" }}>
                      {DEMO_AGENCY.name}
                    </div>
                    <div style={{ fontSize: "0.78rem", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                      Office of the City Clerk
                    </div>
                  </div>
                </div>
                <p style={{ margin: 0, maxWidth: 380 }}>
                  Records requests are processed under the California Public Records Act
                  (Gov. Code § 7920 et seq.). Every release is reviewed and approved by a
                  named member of staff.
                </p>
              </div>

              <div>
                <div className="gov-footer-title">Public records</div>
                <ul>
                  <li>
                    <Link href="/portal/request">File a request</Link>
                  </li>
                  <li>
                    <Link href="/portal/track">Track a request</Link>
                  </li>
                  <li>
                    <Link href="/portal/archive">Browse released records</Link>
                  </li>
                  <li>
                    <Link href="/app">Staff workspace</Link>
                  </li>
                </ul>
              </div>

              <div>
                <div className="gov-footer-title">Records office</div>
                <ul>
                  <li>City Hall, 100 Civic Center Plaza</li>
                  <li>Riverton, CA 90000</li>
                  <li>Mon–Fri, 8:00 a.m.–5:00 p.m.</li>
                  <li>
                    <a href="mailto:records@riverton.gov">records@riverton.gov</a>
                  </li>
                </ul>
              </div>
            </div>

            <div className="gov-footer-bottom">
              <span>© {new Date().getFullYear()} {DEMO_AGENCY.name}. An equal-opportunity public agency.</span>
              <span>
                Powered by {branding.productName} — AI proposes, staff disposes; every release
                carries a named human approval.
              </span>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
