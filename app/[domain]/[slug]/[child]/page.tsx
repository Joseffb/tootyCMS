import { notFound } from "next/navigation";
import { createKernelForRequest } from "@/lib/plugin-runtime";
import { getDomainPostData } from "@/lib/fetchers";
import SitePostContent from "../page-content";

type Params = Promise<{ domain: string; slug: string; child: string }>;

export default async function DomainPostPage({ params }: { params: Params }) {
  const resolved = await params;
  const decodedDomain = decodeURIComponent(resolved.domain);
  const decodedDataDomain = decodeURIComponent(resolved.slug);
  const decodedSlug = decodeURIComponent(resolved.child);

  const kernel = await createKernelForRequest();
  await kernel.doAction("content:load", {
    domain: decodedDomain,
    dataDomain: decodedDataDomain,
    slug: decodedSlug,
  });

  const data = await getDomainPostData(decodedDomain, decodedDataDomain, decodedSlug);
  if (!data) notFound();

  const layout = await kernel.applyFilters("render:layout", (data as any).layout ?? "post", {
    domain: decodedDomain,
    dataDomain: decodedDataDomain,
    slug: decodedSlug,
  });

  return <SitePostContent postData={{ ...(data as any), layout }} />;
}
