import type { ReactNode } from "react";
import { ALL_STAFF_ROLES, requireStaff } from "@/auth/guards";
import { StaffNav } from "../../../_components/StaffNav";

/**
 * Everything under /[agency]/app (except /app/login, which sits outside this
 * route group) requires a signed-in staff member of THIS agency. A staff
 * session from another tenant redirects to this agency's staff login.
 *
 * The layout only AUTHENTICATES (any role — responders included, or they
 * could never reach /app/tasks). Role gating happens per page: pages calling
 * requireStaff(slug) with no roles list default-deny responders.
 *
 * It also mounts the persistent workspace nav — one rail on every staff
 * page, so navigation never routes back through the command center.
 */
export default async function SecureStaffLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ agency: string }>;
}) {
  const { agency: slug } = await params;
  await requireStaff(slug, ALL_STAFF_ROLES);
  return (
    <>
      <StaffNav agencySlug={slug} />
      {children}
    </>
  );
}
