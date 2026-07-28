"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { branding } from "@/config/branding";

const LINKS = [
  { href: "/", label: "Portal" },
  { href: "/app", label: "Staff workspace" },
];

export function Nav() {
  const path = usePathname();
  return (
    <header className="nav">
      <div className="wrap nav-inner">
        <Link href="/" className="brand" aria-label={`${branding.productName} home`}>
          <span className="brand-mark">C</span>
          {branding.productName}
        </Link>
        <nav className="nav-links" aria-label="Primary">
          {LINKS.map((l) => {
            const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className="nav-link"
                aria-current={active ? "page" : undefined}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
