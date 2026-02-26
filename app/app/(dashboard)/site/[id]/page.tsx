import { getSession } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import { getAuthorizedSiteForAnyCapability } from "@/lib/authorization";
type Props = {
  params: Promise<{
    id: string
  }>
}
export default async function SitePosts({ params }: Props) {
  const id = (await params).id;
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const siteId = decodeURIComponent(id);
  const data = await getAuthorizedSiteForAnyCapability(session.user.id, siteId, [
    "site.content.create",
    "site.content.edit.own",
    "site.content.edit.any",
    "site.content.publish",
  ]);
  if (!data) {
    notFound();
  }
  redirect(`/app/site/${siteId}/domain/post`);
}
