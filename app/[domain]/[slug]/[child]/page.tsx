import { notFound } from "next/navigation";
import { createKernelForRequest } from "@/lib/plugin-runtime";
import { getDomainPostData } from "@/lib/fetchers";
import SitePostContent from "../page-content";
import { getThemeDetailTemplateByHierarchy, getThemeLayoutTemplateForSite, getThemeTemplateForSite } from "@/lib/theme-runtime";
import { renderThemeTemplate } from "@/lib/theme-template";
import { getSiteUrlSetting } from "@/lib/cms-config";
import { getRootSiteUrl, getSitePublicUrl } from "@/lib/site-url";
import { toDateString } from "@/lib/utils";
import { toThemePostHtml } from "@/lib/theme-post-html";
import { parseGalleryMediaFromContent } from "@/lib/gallery-media";

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

  const site = (data as any)?.site;
  const siteId = site?.id as string | undefined;
  const isPrimary = Boolean(site?.isPrimary) || site?.subdomain === "main";
  const configuredRootUrl = isPrimary ? (await getSiteUrlSetting()).value.trim() : "";
  const derivedSiteUrl = getSitePublicUrl({
    subdomain: site?.subdomain,
    customDomain: site?.customDomain,
    isPrimary,
  });
  const siteUrl = configuredRootUrl || derivedSiteUrl;
  const rootUrl = getRootSiteUrl();

  if (siteId) {
    const normalizedLayout = String(layout || "post").trim().toLowerCase();
    const themedTemplate =
      (await getThemeLayoutTemplateForSite(siteId, {
        layout: normalizedLayout,
        dataDomain: decodedDataDomain,
      })) ||
      (await getThemeDetailTemplateByHierarchy(siteId, {
        dataDomain: decodedDataDomain,
        slug: decodedSlug,
      })) || (await getThemeTemplateForSite(siteId, "post"));

    if (themedTemplate) {
      const html = renderThemeTemplate(themedTemplate.template, {
        theme_header: themedTemplate.partials?.header || "",
        theme_footer: themedTemplate.partials?.footer || "",
        site: {
          id: site?.id,
          name: site?.name || "Tooty Site",
          description: site?.description || "",
          subtitle: site?.heroSubtitle || "",
          url: siteUrl,
          domain: siteUrl.replace(/^https?:\/\//, ""),
        },
        post: {
          title: (data as any)?.title || "Untitled",
          description: (data as any)?.description || "",
          slug: (data as any)?.slug || decodedSlug,
          href: `${siteUrl.replace(/\/$/, "")}/${decodedDataDomain}/${(data as any)?.slug || decodedSlug}`,
          created_at: (data as any)?.createdAt ? toDateString((data as any).createdAt) : "",
          layout,
          content_html: toThemePostHtml((data as any)?.content || ""),
        },
        gallery_media: parseGalleryMediaFromContent((data as any)?.content || ""),
        content: toThemePostHtml((data as any)?.content || ""),
        links: {
          root: rootUrl,
          main_site: siteUrl,
          posts: `${siteUrl.replace(/\/$/, "")}/posts`,
        },
        route_kind: "post_detail",
        data_domain: decodedDataDomain,
      });
      return <div className="tooty-theme-template" dangerouslySetInnerHTML={{ __html: html }} />;
    }
  }

  return <SitePostContent postData={{ ...(data as any), layout }} />;
}
