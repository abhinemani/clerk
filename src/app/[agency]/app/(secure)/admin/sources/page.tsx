import { redirect } from "next/navigation";

/** Consolidated into /app/admin/data — kept as a redirect for old links/bookmarks. */
export default async function ConnectedSourcesPageRedirect({
  params,
}: {
  params: Promise<{ agency: string }>;
}) {
  const { agency: slug } = await params;
  redirect(`/${slug}/app/admin/data`);
}
