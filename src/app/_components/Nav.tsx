"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { portalSignOut } from "../[agency]/actions";
import { CivicIcon, Seal } from "./ui";

export interface NavSession {
  kind: "staff" | "requester";
  name: string;
}

/** The governmental header for one tenant's portal. */
export function Nav({
  agencyName,
  agencySlug,
  stateName,
  session,
}: {
  agencyName: string;
  agencySlug: string;
  stateName: string;
  session: NavSession | null;
}) {
  const path = usePathname();
  const base = `/${agencySlug}`;

  const links = [
    { href: base, label: "Portal", exact: true },
    { href: `${base}/track`, label: "Track a request" },
    { href: `${base}/archive`, label: "Public archive" },
    session?.kind === "staff"
      ? { href: `${base}/app`, label: "Staff workspace" }
      : session?.kind === "requester"
        ? { href: `${base}/account`, label: "My requests" }
        : { href: `${base}/login`, label: "Sign in" },
  ];

  return (
    <header>
      {/* The "you are on an official government site" strip */}
      <div className="gov-banner">
        <div className="wrap gov-banner-inner">
          <CivicIcon />
          <span>
            <strong>
              An official website of the {agencyName}, {stateName}
            </strong>
          </span>
          {session ? (
            <span className="hide-sm" style={{ marginLeft: "auto", display: "inline-flex", gap: 10, alignItems: "center" }}>
              <span className="muted-inverse">Signed in as {session.name}</span>
              <form action={portalSignOut.bind(null, agencySlug)} style={{ display: "inline" }}>
                <button
                  type="submit"
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                    color: "#dde5f0",
                    textDecoration: "underline",
                    font: "inherit",
                  }}
                >
                  Sign out
                </button>
              </form>
            </span>
          ) : (
            <span className="muted-inverse hide-sm" style={{ marginLeft: "auto" }}>
              Office of the City Clerk · Public Records Division
            </span>
          )}
        </div>
      </div>

      <div className="nav">
        <div className="wrap nav-inner">
          <Link href={base} className="brand" aria-label={`${agencyName} public records home`}>
            <Seal size={38} />
            <span className="brand-name">
              <span className="brand-agency">{agencyName}</span>
              <span className="brand-dept">Public Records</span>
            </span>
          </Link>
          <nav className="nav-links" aria-label="Primary">
            {links.map((l) => {
              const active = l.exact
                ? path === l.href || path === `${base}/request`
                : path.startsWith(l.href);
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
