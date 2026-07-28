import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { branding } from "@/config/branding";
import { DEMO_AGENCY } from "@/lib/demo";
import { Nav } from "./_components/Nav";

export const metadata: Metadata = {
  title: `${branding.productName} — ${branding.tagline}`,
  description: branding.tagline,
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
        <footer style={{ borderTop: "1px solid var(--border)", marginTop: 72 }}>
          <div
            className="wrap"
            style={{
              paddingBlock: 28,
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
              justifyContent: "space-between",
              color: "var(--muted)",
              fontSize: "0.85rem",
            }}
          >
            <span>
              {branding.productName} · {DEMO_AGENCY.name} public records
            </span>
            <span>AI proposes, staff disposes — every release carries a named human approval.</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
