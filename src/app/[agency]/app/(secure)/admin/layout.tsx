/**
 * Admin section wrapper — OFFICIAL PAPER (owner directive 2026-08-14: the
 * admin surfaces read more official on white/cream). The class scopes a
 * token re-pin in globals.css that turns every card/panel in the admin
 * section into a light plate on the dark lit ground — cream documents on
 * the desk, not a theme switch. Page chrome (nav, rail, section headings on
 * the ground) stays dark; only the plates flip.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <div className="admin-paper">{children}</div>;
}
