"use client";

/**
 * Persistent staff-workspace navigation — every /app page gets the same
 * second-level rail, so moving queue → records → outbox → reports is one
 * click, not a round-trip through the command center. Role gating stays in
 * the page guards (a responder clicking Queue lands on their task list, by
 * design); the nav only ever links.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { seg: "", label: "Queue", exact: false, alsoPrefix: "/requests" },
  { seg: "/tasks", label: "Tasks" },
  { seg: "/records", label: "Records" },
  { seg: "/search", label: "Search" },
  { seg: "/agents", label: "Agents" },
  { seg: "/reports", label: "Reports" },
  { seg: "/outbox", label: "Outbox" },
  { seg: "/admin", label: "Admin" },
] as const;

export function StaffNav({ agencySlug }: { agencySlug: string }) {
  const path = usePathname();
  const base = `/${agencySlug}/app`;

  const isActive = (l: (typeof LINKS)[number]): boolean => {
    const href = `${base}${l.seg}`;
    if (l.seg === "") {
      return path === base || path.startsWith(`${base}${l.alsoPrefix ?? "/requests"}`);
    }
    return path === href || path.startsWith(`${href}/`);
  };

  return (
    <nav className="staff-nav" aria-label="Staff workspace">
      <div className="wrap staff-nav-row">
        {LINKS.map((l) => (
          <Link
            key={l.seg}
            href={`${base}${l.seg}`}
            className={`staff-nav-link${isActive(l) ? " is-active" : ""}`}
            aria-current={isActive(l) ? "page" : undefined}
          >
            {l.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
