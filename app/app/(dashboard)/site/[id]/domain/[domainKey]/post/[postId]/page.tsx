import { redirect } from "next/navigation";
import { getDomainPostAdminItemPath } from "@/lib/domain-post-admin-routes";

type Props = {
  params: Promise<{
    id: string;
    domainKey: string;
    postId: string;
  }>;
};

export default async function DomainPostCompatibilityRedirectPage({ params }: Props) {
  const { id, domainKey, postId } = await params;
  redirect(getDomainPostAdminItemPath(decodeURIComponent(id), decodeURIComponent(domainKey), decodeURIComponent(postId)));
}
