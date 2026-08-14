import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepository } from "@/db/createRepository";
import { getAgencyForSlug } from "@/lib/live";
import { verifyRequesterEmail } from "@/services/accountService";
import { defaultDeps } from "@/services/deps";

export const dynamic = "force-dynamic";

/** One-time email-verification landing: burns the token, unlocks history. */
export default async function VerifyPage({
  params,
  searchParams,
}: {
  params: Promise<{ agency: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const [{ agency: slug }, { token }] = await Promise.all([params, searchParams]);
  const agency = await getAgencyForSlug(slug);
  if (!agency) notFound();

  // Redemption is scoped to THIS portal's agency; an unbootstrapped demo
  // agency (id: null) can't have minted a token, so there's nothing to burn.
  const requester =
    token && agency.id
      ? await verifyRequesterEmail(defaultDeps(await getRepository()), agency.id, token)
      : null;

  return (
    <div className="wrap" style={{ maxWidth: 520, paddingBlock: "var(--page-top) var(--page-bottom)" }}>
      <span className="eyebrow">{agency.name} · Public Records</span>
      {requester ? (
        <>
          <h1 style={{ fontSize: "1.8rem", marginTop: 8 }}>Email verified ✓</h1>
          <p className="muted" style={{ marginTop: 10 }}>
            Thanks{requester.name ? `, ${requester.name.split(" ")[0]}` : ""} — your address is
            confirmed and your request history is now visible in your account.
          </p>
          <Link href={`/${agency.slug}/account`} className="btn btn-primary" style={{ marginTop: 18 }}>
            Go to my requests
          </Link>
        </>
      ) : (
        <>
          <h1 style={{ fontSize: "1.8rem", marginTop: 8 }}>That link didn&apos;t work</h1>
          <p className="muted" style={{ marginTop: 10 }}>
            Verification links are single-use and expire after 48 hours. Sign in and we can send a
            fresh one.
          </p>
          <Link href={`/${agency.slug}/login`} className="btn btn-primary" style={{ marginTop: 18 }}>
            Sign in
          </Link>
        </>
      )}
    </div>
  );
}
