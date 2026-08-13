import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { branding } from "@/config/branding";
import { BrandMark } from "../_components/ui";

export const metadata: Metadata = {
  title: `${branding.productName} · Platform console`,
};

/** Product-side chrome for the cross-tenant operator console. */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="gov-banner">
        <div className="wrap gov-banner-inner">
          <strong>{branding.productName} · Platform console</strong>
          <span className="muted-inverse" style={{ marginLeft: "auto" }}>
            Operator access only
          </span>
        </div>
      </div>
      <div className="nav">
        <div className="wrap nav-inner">
          <Link href="/admin" className="brand" aria-label={`${branding.productName} platform console`}>
            <BrandMark size={26} idPrefix="adm" />
            <span className="brand-name">
              <span className="brand-agency">{branding.productName}</span>
              <span className="brand-dept">All agencies</span>
            </span>
          </Link>
          <nav className="nav-links" aria-label="Primary">
            <Link href="/" className="nav-link">
              Marketing site
            </Link>
          </nav>
        </div>
      </div>
      <main id="main">{children}</main>
    </>
  );
}
