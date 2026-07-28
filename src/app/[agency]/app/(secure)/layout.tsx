import type { ReactNode } from "react";
import { requireStaff } from "@/auth/guards";

/**
 * Everything under /[agency]/app (except /app/login, which sits outside this
 * route group) requires a signed-in staff member of THIS agency. A staff
 * session from another tenant redirects to this agency's staff login.
 */
export default async function SecureStaffLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ agency: string }>;
}) {
  const { agency: slug } = await params;
  await requireStaff(slug);
  return <>{children}</>;
}
