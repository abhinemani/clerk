"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CivicIcon, Seal } from "./ui";

const LINKS = [
  { href: "/", label: "Portal" },
  { href: "/portal/track", label: "Track a request" },
  { href: "/portal/archive", label: "Public archive" },
  { href: "/app", label: "Staff workspace" },
];

export function Nav() {
  const path = usePathname();
  return (
    <header>
      {/* The "you are on an official government site" strip */}
      <div className="gov-banner">
        <div className="wrap gov-banner-inner">
          <CivicIcon />
          <span>
            <strong>An official website of the City of Riverton, California</strong>
          </span>
          <span className="muted-inverse hide-sm" style={{ marginLeft: "auto" }}>
            Office of the City Clerk · Public Records Division
          </span>
        </div>
      </div>

      <div className="nav">
        <div className="wrap nav-inner">
          <Link href="/" className="brand" aria-label="City of Riverton public records home">
            <Seal size={38} />
            <span className="brand-name">
              <span className="brand-agency">City of Riverton</span>
              <span className="brand-dept">Public Records</span>
            </span>
          </Link>
          <nav className="nav-links" aria-label="Primary">
            {LINKS.map((l) => {
              const active =
                l.href === "/" ? path === "/" || path === "/portal/request" : path.startsWith(l.href);
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
      </div>
    </header>
  );
}
