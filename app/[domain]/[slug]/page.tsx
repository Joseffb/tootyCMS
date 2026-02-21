import { notFound } from "next/navigation";
import { getPostData } from "@/lib/fetchers";
import SitePostContent from "./page-content";
import db from "@/lib/db";
import { eq } from "drizzle-orm";
import { posts, termRelationships, termTaxonomies, terms } from "@/lib/schema"; // This is a client component.
import { createKernelForRequest } from "@/lib/plugin-runtime";
import { getSiteMenu } from "@/lib/menu-system";
import { getActiveThemeForSite, getThemeLayoutTemplateForSite, getThemeTemplateForSite } from "@/lib/theme-runtime";
import { renderThemeTemplate } from "@/lib/theme-template";
import { toDateString } from "@/lib/utils";
import { getRootSiteUrl, getSitePublicUrl } from "@/lib/site-url";
import { getSiteUrlSetting } from "@/lib/cms-config";
import { toThemePostHtml } from "@/lib/theme-post-html";
import { parseGalleryMediaFromContent } from "@/lib/gallery-media";

// We expect params to be a Promise resolving to an object with domain and slug.
type Params = Promise<{ domain: string; slug: string }>;

export default async function SitePostPage({
                                             params,
                                           }: {
  params: Params;
}) {
  // Await the entire params object.
  const resolvedParams = await params;
  const post = await db.query.posts.findFirst({
    where: eq(posts.slug, resolvedParams.slug),
    columns: {
      title: true,
      content: true,
      layout: true,
      slug: true,
    },
  });

  const decodedDomain = decodeURIComponent(resolvedParams.domain);
  const decodedSlug = decodeURIComponent(resolvedParams.slug);
  const kernel = await createKernelForRequest();
  await kernel.doAction("content:load", { domain: decodedDomain, slug: decodedSlug });
  const data = await getPostData(decodedDomain, decodedSlug);
  if (!data) {
    notFound();
  }

  const layout = await kernel.applyFilters("render:layout", post?.layout ?? "post", {
    domain: decodedDomain,
    slug: decodedSlug,
  });
  const siteId = (data as any)?.site?.id as string | undefined;
  const baseHeaderMenu = siteId ? await getSiteMenu(siteId, "header") : [];
  const menuItems = siteId
    ? await kernel.applyFilters("nav:items", baseHeaderMenu, {
        location: "header",
        domain: decodedDomain,
        siteId,
      })
    : [];
  const activeTheme = siteId ? await getActiveThemeForSite(siteId) : null;
  const documentationCategorySlug =
    typeof activeTheme?.config?.documentation_category_slug === "string" &&
    activeTheme.config.documentation_category_slug.trim().length > 0
      ? activeTheme.config.documentation_category_slug.trim().toLowerCase()
      : "documentation";
  const categoryRows =
    (data as any)?.id
      ? await db
          .select({ slug: terms.slug })
          .from(termRelationships)
          .innerJoin(termTaxonomies, eq(termTaxonomies.id, termRelationships.termTaxonomyId))
          .innerJoin(terms, eq(terms.id, termTaxonomies.termId))
          .where(eq(termRelationships.objectId, (data as any).id))
      : [];
  const categorySlugs = categoryRows
    .map((row) => row.slug)
    .filter((slug): slug is string => typeof slug === "string");
  const themeId = activeTheme?.id || "tooty-default";
  const isPrimary = Boolean((data as any)?.site?.isPrimary) || (data as any)?.site?.subdomain === "main";
  const configuredRootUrl = isPrimary ? (await getSiteUrlSetting()).value.trim() : "";
  const derivedSiteUrl = getSitePublicUrl({
    subdomain: (data as any)?.site?.subdomain,
    customDomain: (data as any)?.site?.customDomain,
    isPrimary,
  });
  const siteUrl = configuredRootUrl || derivedSiteUrl;
  const rootUrl = getRootSiteUrl();

  if (siteId) {
    const normalizedLayout = String(layout || "post").trim().toLowerCase();
    const themeTemplate =
      (await getThemeLayoutTemplateForSite(siteId, { layout: normalizedLayout })) ||
      (await getThemeTemplateForSite(siteId, "post"));
    if (themeTemplate) {
      const html = renderThemeTemplate(themeTemplate.template, {
        theme_header: themeTemplate.partials?.header || "",
        theme_footer: themeTemplate.partials?.footer || "",
        site: {
          id: (data as any)?.site?.id,
          name: (data as any)?.site?.name || "Tooty Site",
          description: (data as any)?.site?.description || "",
          subtitle: (data as any)?.site?.heroSubtitle || "",
          url: siteUrl,
          domain: siteUrl.replace(/^https?:\/\//, ""),
        },
        post: {
          title: (data as any)?.title || "Untitled",
          description: (data as any)?.description || "",
          slug: (data as any)?.slug || decodedSlug,
          href: `${siteUrl.replace(/\/$/, "")}/${(data as any)?.slug || decodedSlug}`,
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
        theme: {
          id: themeTemplate.themeId || "",
          name: themeTemplate.themeName || "",
          ...(themeTemplate.config || {}),
        },
        route_kind: "post_detail",
        data_domain: "post",
      });
      return <div className="tooty-theme-template" dangerouslySetInnerHTML={{ __html: html }} />;
    }
  }

  const postData = {
    ...data,
    layout,
    menuItems,
    categorySlugs,
    primals: {
      public_image_base: `/theme-assets/${themeId}`,
      documentation_category_slug: documentationCategorySlug,
    },
  };
  return <SitePostContent postData={postData} />;
}
