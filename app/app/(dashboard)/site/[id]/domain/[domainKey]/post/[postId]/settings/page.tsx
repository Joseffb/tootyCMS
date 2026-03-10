import { redirect } from "next/navigation";
import { getDomainPostAdminItemSettingsPath } from "@/lib/domain-post-admin-routes";

type Props = {
  params: Promise<{
    id: string;
    domainKey: string;
    postId: string;
  }>;
};

export default async function DomainPostSettingsCompatibilityRedirect({ params }: Props) {
  const { id, domainKey, postId } = await params;
  redirect(
    getDomainPostAdminItemSettingsPath(
      decodeURIComponent(id),
      decodeURIComponent(domainKey),
      decodeURIComponent(postId),
    ),
  );
}
