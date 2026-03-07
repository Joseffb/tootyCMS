import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createKernelForRequest } from "@/lib/plugin-runtime";
import { getDomainPostData, getMdxSource, getPostData, getSiteData } from "@/lib/fetchers";
import SitePostContent from "../page-content";
import { getThemeDetailTemplateByHierarchy, getThemeLayoutTemplateForSite, getThemeTemplateFromCandidates } from "@/lib/theme-runtime";
import { renderThemeTemplate } from "@/lib/theme-template";
import { getSiteUrlSettingForSite, getSiteWritingSettings } from "@/lib/cms-config";
import { getRootSiteUrl, getSitePublicUrl } from "@/lib/site-url";
import { toDateString } from "@/lib/utils";
import { toThemePostHtml } from "@/lib/theme-post-html";
import { parseGalleryMediaFromContent } from "@/lib/gallery-media";
import { getSiteMenu, normalizeMenuItemsForPermalinks } from "@/lib/menu-system";
import { normalizeDomainKeyFromSegment } from "@/lib/data-domain-routing";
import { buildArchivePath, buildDetailPath, resolveNoDomainPrefixDomain } from "@/lib/permalink";
import { trace } from "@/lib/debug";
import { hasPostPasswordAccess, requiresPostPasswordGate } from "@/lib/post-password";
import { getThemeRenderContext } from "@/lib/theme-render-context";
import { isPluginManagedDataDomain } from "@/lib/plugin-content-types";
import PostViewTracker from "@/components/post-view-tracker";
import { getPublicCommentCapabilities } from "@/lib/comments-spine";
import { hydrateCommentsSlotMarkup } from "@/lib/comments-slot-bootstrap";

type Params = Promise<{ domain: string; slug: string; child: string }>;

export default async function DomainPostPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolved = await params;
  const resolvedSearchParams = (await searchParams) || {};
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

  const kernel = await createKernelForRequest(site.id as string);
  await kernel.doAction("content:load", {
    domain: decodedDomain,
    dataDomain: decodedDataDomain,
    slug: decodedSlug,
  });

  const data = isCorePostDomain
    ? await getPostData(decodedDomain, decodedSlug, {
        includeMdxSource: false,
        includeAdjacentPosts: false,
      })
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
  const canonicalSite = resolvedSite?.id ? resolvedSite : site;
  const passwordError = String(resolvedSearchParams?.pw || "") === "invalid";
  const isPasswordProtected = requiresPostPasswordGate({
    usePassword: (data as any)?.usePassword,
    password: (data as any)?.password,
  });
  if (isPasswordProtected) {
    const cookieStore = await cookies();
    const unlocked = hasPostPasswordAccess(cookieStore, {
      postId: String((data as any)?.id || ""),
      password: String((data as any)?.password || ""),
    });
    if (!unlocked) {
      return (
        <main className="mx-auto min-h-screen w-full max-w-xl px-5 py-14">
          <div className="rounded-2xl border border-stone-300 bg-white p-6 shadow-sm">
            <h1 className="text-2xl font-semibold text-stone-900">This post is password protected</h1>
            <p className="mt-2 text-sm text-stone-600">Enter the password to view content and comments.</p>
            <form method="post" action="/api/post-password" className="mt-5 space-y-3">
              <input type="hidden" name="postId" value={String((data as any)?.id || "")} />
              <input type="hidden" name="returnTo" value={canonicalPath} />
              <label className="block text-sm font-medium text-stone-700">
                Password
                <input
                  name="password"
                  type="password"
                  required
                  className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-900"
                />
              </label>
              {passwordError ? <p className="text-sm text-red-600">Incorrect password. Please try again.</p> : null}
              <button
                type="submit"
                className="inline-flex items-center rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700"
              >
                View post
              </button>
            </form>
          </div>
        </main>
      );
    }
  }
  const siteId = canonicalSite?.id as string | undefined;
  const isPrimary = Boolean(canonicalSite?.isPrimary) || canonicalSite?.subdomain === "main";
  let configuredRootUrl = "";
  if (siteId) {
    try {
      configuredRootUrl = (await getSiteUrlSettingForSite(siteId, "")).value.trim();
    } catch {
      configuredRootUrl = "";
    }
  }
  const derivedSiteUrl = getSitePublicUrl({
    subdomain: canonicalSite?.subdomain,
    customDomain: canonicalSite?.customDomain,
    isPrimary,
  });
  const siteUrl = configuredRootUrl || derivedSiteUrl;
  const rootUrl = getRootSiteUrl();
  const postMeta = Array.isArray((data as any)?.meta) ? ((data as any).meta as Array<{ key?: string; value?: string }>) : [];
  const baseHeaderMenu = siteId ? await getSiteMenu(siteId, "header") : [];
  const rawMenuItems = siteId
    ? await kernel.applyFilters("nav:items", baseHeaderMenu, {
        location: "header",
        domain: decodedDomain,
        siteId,
      })
    : [];
  const menuItems = normalizeMenuItemsForPermalinks(rawMenuItems, writing);

  if (siteId) {
    const normalizedLayout = String(layout || "post").trim().toLowerCase();
    const pluginManaged = await isPluginManagedDataDomain(siteId, decodedDataDomain);
    const themedTemplate =
      (await getThemeDetailTemplateByHierarchy(siteId, {
        dataDomain: decodedDataDomain,
        slug: decodedSlug,
      })) ||
      (pluginManaged
        ? null
        : (await getThemeLayoutTemplateForSite(siteId, {
            layout: normalizedLayout,
            dataDomain: decodedDataDomain,
          })) ||
          (await getThemeTemplateFromCandidates(siteId, ["single.html", "index.html"])));

    if (themedTemplate) {
      const themeRuntime = await getThemeRenderContext(
        siteId,
        "domain_detail",
        [
          themedTemplate.template,
          themedTemplate.partials?.header,
          themedTemplate.partials?.footer,
        ],
        {
          kernel,
          slotContext: {
            entry: {
              id: (data as any)?.id || "",
              dataDomain: decodedDataDomain,
              meta: postMeta,
            },
          },
        },
      );
      const html = renderThemeTemplate(themedTemplate.template, {
        theme_header: themedTemplate.partials?.header || "",
        theme_footer: themedTemplate.partials?.footer || "",
        theme_menu: themedTemplate.partials?.menu || "",
        theme_menu_item: themedTemplate.partials?.menuItem || "",
        theme_menu_header: themedTemplate.partials?.menuByLocation?.header || "",
        theme_menu_footer: themedTemplate.partials?.menuByLocation?.footer || "",
        theme_menu_dashboard: themedTemplate.partials?.menuByLocation?.dashboard || "",
        theme_menu_item_header: themedTemplate.partials?.menuItemByLocation?.header || "",
        theme_menu_item_footer: themedTemplate.partials?.menuItemByLocation?.footer || "",
        theme_menu_item_dashboard: themedTemplate.partials?.menuItemByLocation?.dashboard || "",
        theme_menu_by_location: themedTemplate.partials?.menuByLocation || {},
        theme_menu_item_by_location: themedTemplate.partials?.menuItemByLocation || {},
        theme_menu_by_location_and_key: themedTemplate.partials?.menuByLocationAndKey || {},
        theme_menu_item_by_location_and_key: themedTemplate.partials?.menuItemByLocationAndKey || {},
        site: {
          id: canonicalSite?.id,
          name: canonicalSite?.name || "Tooty Site",
          description: canonicalSite?.description || "",
          subtitle: canonicalSite?.heroSubtitle || "",
          url: siteUrl,
          domain: siteUrl.replace(/^https?:\/\//, ""),
        },
        post: {
          id: (data as any)?.id || "",
          title: (data as any)?.title || "Untitled",
          description: (data as any)?.description || "",
          image: (data as any)?.image || "",
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
          posts: `${siteUrl.replace(/\/$/, "")}${buildArchivePath(decodedDataDomain, writing)}`,
          about: `${siteUrl.replace(/\/$/, "")}${buildDetailPath("page", "about-this-site", writing)}`,
          tos: `${siteUrl.replace(/\/$/, "")}${buildDetailPath("page", "terms-of-service", writing)}`,
          privacy: `${siteUrl.replace(/\/$/, "")}${buildDetailPath("page", "privacy-policy", writing)}`,
        },
        menu_items: menuItems,
        tooty: themeRuntime.tooty,
        auth: themeRuntime.auth,
        route_kind: "domain_detail",
        data_domain: decodedDataDomain,
      });
      const hydratedHtml = hydrateCommentsSlotMarkup(
        html,
        await getPublicCommentCapabilities(siteId),
      );
      return (
        <>
          <div className="tooty-theme-template" dangerouslySetInnerHTML={{ __html: hydratedHtml }} />
          <PostViewTracker
            postId={String((data as any)?.id || "")}
            siteId={siteId || ""}
            dataDomainKey={decodedDataDomain}
          />
        </>
      );
    }
  }

  const postData = {
    ...(data as any),
    mdxSource: (data as any)?.mdxSource ?? (await getMdxSource((data as any)?.content || "")),
    layout,
    menuItems,
    primals: {
      public_image_base: "",
      documentation_category_slug: "documentation",
      category_base: writing.categoryBase || "c",
      tag_base: writing.tagBase || "t",
    },
  };
  if (siteId) {
    const fallbackThemeRuntime = await getThemeRenderContext(siteId, "domain_detail", [], {
      kernel,
      slotContext: {
        entry: {
          id: (data as any)?.id || "",
          dataDomain: decodedDataDomain,
          meta: postMeta,
        },
      },
    });
    postData.themeSlots = fallbackThemeRuntime.tooty?.slots || {};
  }
  return (
    <>
      <SitePostContent postData={postData} />
      <PostViewTracker
        postId={String((data as any)?.id || "")}
        siteId={siteId || ""}
        dataDomainKey={decodedDataDomain}
      />
    </>
  );
}
