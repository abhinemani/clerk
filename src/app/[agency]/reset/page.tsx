import { notFound } from "next/navigation";
import { getAgencyForSlug } from "@/lib/live";
import { ResetPasswordForm } from "../../_components/PasswordForms";

const KINDS = new Set(["reset_requester", "reset_staff", "staff_invite"]);

/** Landing for reset + invite links: set a new password, single-use token. */
export default async function ResetPage({
  params,
  searchParams,
}: {
  params: Promise<{ agency: string }>;
  searchParams: Promise<{ token?: string; kind?: string }>;
}) {
  const [{ agency: slug }, { token, kind }] = await Promise.all([params, searchParams]);
  const agency = await getAgencyForSlug(slug);
  if (!agency || !token || !kind || !KINDS.has(kind)) notFound();
  const tokenKind = kind as "reset_requester" | "reset_staff" | "staff_invite";

  return (
    <div className="wrap" style={{ maxWidth: 480, paddingBlock: "var(--page-top) var(--page-bottom)" }}>
      <span className="eyebrow">{agency.name}</span>
      <h1 style={{ fontSize: "1.8rem", marginTop: 8, marginBottom: 8, fontWeight: 600 }}>
        {tokenKind === "staff_invite" ? "Activate your staff account" : "Choose a new password"}
      </h1>
      <ResetPasswordForm agencySlug={agency.slug} token={token} kind={tokenKind} />
    </div>
  );
}
