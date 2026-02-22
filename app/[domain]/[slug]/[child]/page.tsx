import { notFound, redirect } from "next/navigation";
import { createKernelForRequest } from "@/lib/plugin-runtime";
import { getDomainPostData, getPostData, getSiteData } from "@/lib/fetchers";
import SitePostContent from "../page-content";
import { getThemeDetailTemplateByHierarchy, getThemeLayoutTemplateForSite, getThemeTemplateFromCandidates } from "@/lib/theme-runtime";
import { renderThemeTemplate } from "@/lib/theme-template";
import { getSiteUrlSettingForSite, getSiteWritingSettings } from "@/lib/cms-config";
import { getRootSiteUrl, getSitePublicUrl } from "@/lib/site-url";
import { toDateString } from "@/lib/utils";
import { toThemePostHtml } from "@/lib/theme-post-html";
import { parseGalleryMediaFromContent } from "@/lib/gallery-media";
import { getSiteMenu } from "@/lib/menu-system";
import { normalizeDomainKeyFromSegment } from "@/lib/data-domain-routing";
import { buildArchivePath, buildDetailPath, resolveNoDomainPrefixDomain } from "@/lib/permalink";
import { trace } from "@/lib/debug";

type Params = Promise<{ domain: string; slug: string; child: string }>;

export default async function DomainPostPage({ params }: { params: Params }) {
  const resolved = await params;
  const decodedDomain = decodeURIComponent(resolved.domain);
  const rawSegment = decodeURIComponent(resolved.slug);
  const site = await getSiteData(decodedDomain);
  if (!site) notFound();
  const writing = await getSiteWritingSettings(site.id as string);
  const mappedPrefixDomain = resolveNoDomainPrefixDomain(rawSegment, writing);
  const decodedDataDomain = mappedPrefixDomain || normalizeDomainKeyFromSegment(rawSegment);
  const isCorePostDomain = decodedDataDomain === "post";
  const decodedSlug = decodeURIComponent(resolved.child);
  trace("routing", "domain detail route resolved", {
    domain: decodedDomain,
    rawSegment,
    dataDomain: decodedDataDomain,
    slug: decodedSlug,
    permalinkMode: writing.permalinkMode,
    mappedPrefix: Boolean(mappedPrefixDomain),
  });

  const kernel = await createKernelForRequest();
  await kernel.doAction("content:load", {
    domain: decodedDomain,
    dataDomain: decodedDataDomain,
    slug: decodedSlug,
  });

  const data = isCorePostDomain
    ? await getPostData(decodedDomain, decodedSlug)
    : await getDomainPostData(decodedDomain, decodedDataDomain, decodedSlug);
  if (!data) {
    notFound();
  }

  const canonicalPath = buildDetailPath(decodedDataDomain, decodedSlug, writing);
  if (`/${rawSegment}/${decodedSlug}` !== canonicalPath) {
    trace("routing", "domain detail redirect to canonical", {
      from: `/${rawSegment}/${decodedSlug}`,
      to: canonicalPath,
      dataDomain: decodedDataDomain,
    });
    redirect(canonicalPath);
  }

  const layout = await kernel.applyFilters("render:layout", (data as any).layout ?? "post", {
    domain: decodedDomain,
    ...(isCorePostDomain ? {} : { dataDomain: decodedDataDomain }),
    slug: decodedSlug,
  });

  const resolvedSite = (data as any)?.site;
  const siteId = resolvedSite?.id as string | undefined;
  const isPrimary = Boolean(resolvedSite?.isPrimary) || resolvedSite?.subdomain === "main";
  const configuredRootUrl = siteId ? (await getSiteUrlSettingForSite(siteId, "")).value.trim() : "";
  const derivedSiteUrl = getSitePublicUrl({
    subdomain: resolvedSite?.subdomain,
    customDomain: resolvedSite?.customDomain,
    isPrimary,
  });
  const siteUrl = configuredRootUrl || derivedSiteUrl;
  const rootUrl = getRootSiteUrl();
  const baseHeaderMenu = siteId ? await getSiteMenu(siteId, "header") : [];
  const menuItems = siteId
    ? await kernel.applyFilters("nav:items", baseHeaderMenu, {
        location: "header",
        domain: decodedDomain,
        siteId,
      })
    : [];

  if (siteId) {
    const normalizedLayout = String(layout || "post").trim().toLowerCase();
    const themedTemplate =
      (await getThemeDetailTemplateByHierarchy(siteId, {
        dataDomain: decodedDataDomain,
        slug: decodedSlug,
      })) ||
      (await getThemeLayoutTemplateForSite(siteId, {
        layout: normalizedLayout,
        dataDomain: decodedDataDomain,
      })) ||
      (await getThemeTemplateFromCandidates(siteId, ["single.html", "index.html"]));

    if (themedTemplate) {
      const html = renderThemeTemplate(themedTemplate.template, {
        theme_header: themedTemplate.partials?.header || "",
        theme_footer: themedTemplate.partials?.footer || "",
        site: {
          id: resolvedSite?.id,
          name: resolvedSite?.name || "Tooty Site",
          description: resolvedSite?.description || "",
          subtitle: resolvedSite?.heroSubtitle || "",
          url: siteUrl,
          domain: siteUrl.replace(/^https?:\/\//, ""),
        },
        post: {
          title: (data as any)?.title || "Untitled",
          description: (data as any)?.description || "",
          slug: (data as any)?.slug || decodedSlug,
          href: `${siteUrl.replace(/\/$/, "")}${buildDetailPath(decodedDataDomain, (data as any)?.slug || decodedSlug, writing)}`,
          created_at: (data as any)?.createdAt ? toDateString((data as any).createdAt) : "",
          layout,
          content_html: toThemePostHtml((data as any)?.content || ""),
        },
        gallery_media: parseGalleryMediaFromContent((data as any)?.content || ""),
        content: toThemePostHtml((data as any)?.content || ""),
        links: {
          root: rootUrl,
          main_site: siteUrl,
          posts: `${siteUrl.replace(/\/$/, "")}${buildArchivePath("post", writing)}`,
        },
        menu_items: menuItems,
        route_kind: "domain_detail",
        data_domain: decodedDataDomain,
      });
      return <div className="tooty-theme-template" dangerouslySetInnerHTML={{ __html: html }} />;
    }
  }

  return <SitePostContent postData={{ ...(data as any), layout }} />;
}
