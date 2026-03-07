import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getDomainPostsForSite, getMdxSource, getPostData, getSiteData } from "@/lib/fetchers";
import SitePostContent from "./page-content";
import db from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { createKernelForRequest } from "@/lib/plugin-runtime";
import { getSiteMenu, normalizeMenuItemsForPermalinks } from "@/lib/menu-system";
import { getActiveThemeForSite, getThemeDetailTemplateByHierarchy, getThemeLayoutTemplateForSite, getThemeTemplateFromCandidates } from "@/lib/theme-runtime";
import { renderThemeTemplate } from "@/lib/theme-template";
import { toDateString } from "@/lib/utils";
import { getRootSiteUrl, getSitePublicUrl } from "@/lib/site-url";
import { getSiteTextSetting, getSiteUrlSettingForSite, getSiteWritingSettings } from "@/lib/cms-config";
import { toThemePostHtml } from "@/lib/theme-post-html";
import { parseGalleryMediaFromContent } from "@/lib/gallery-media";
import { getSiteTaxonomyTables, withSiteTaxonomyTableRecovery } from "@/lib/site-taxonomy-tables";
import {
  dataDomainDescriptionSettingKey,
  dataDomainKeySettingKey,
  dataDomainLabelSettingKey,
  dataDomainPermalinkSettingKey,
  resolveDataDomainDescription,
} from "@/lib/data-domain-descriptions";
import { pluralizeLabel } from "@/lib/data-domain-labels";
import { isDomainArchiveSegment, normalizeDomainKeyFromSegment, normalizeDomainSegment } from "@/lib/data-domain-routing";
import { domainArchiveTemplateCandidates } from "@/lib/theme-fallback";
import { buildArchivePath, buildDetailPath, domainPluralSegment, resolveNoDomainPrefixDomain } from "@/lib/permalink";
import { trace } from "@/lib/debug";
import { hasPostPasswordAccess, requiresPostPasswordGate } from "@/lib/post-password";
import { getThemeRenderContext } from "@/lib/theme-render-context";
import { isPluginManagedDataDomain } from "@/lib/plugin-content-types";
import { DEFAULT_CORE_DOMAIN_KEYS } from "@/lib/default-data-domains";
import { listSiteDataDomains } from "@/lib/site-data-domain-registry";
import PostViewTracker from "@/components/post-view-tracker";
import { getPublicCommentCapabilities } from "@/lib/comments-spine";
import { hydrateCommentsSlotMarkup } from "@/lib/comments-slot-bootstrap";

// We expect params to be a Promise resolving to an object with domain and slug.
type Params = Promise<{ domain: string; slug: string }>;

export default async function SitePostPage({
                                             params,
                                             searchParams,
                                           }: {
  params: Params;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Await the entire params object.
  const resolvedParams = await params;
  const resolvedSearchParams = (await searchParams) || {};

  const decodedDomain = decodeURIComponent(resolvedParams.domain);
  const decodedSlug = decodeURIComponent(resolvedParams.slug);
  const site = await getSiteData(decodedDomain);
  if (!site) notFound();
  const [writing, existingPost] = await Promise.all([
    getSiteWritingSettings(site.id as string),
    getPostData(decodedDomain, decodedSlug, {
      includeMdxSource: false,
      includeAdjacentPosts: false,
    }),
  ]);
  const normalizedSlug = normalizeDomainSegment(decodedSlug);
  const singularFromSlug = normalizeDomainKeyFromSegment(decodedSlug);
  const noDomainPrefixDomainKey = resolveNoDomainPrefixDomain(decodedSlug, writing);
  trace("routing", "primary slug route resolved", {
    domain: decodedDomain,
    slug: decodedSlug,
    hasCorePost: Boolean(existingPost),
    singularFromSlug,
    noDomainPrefixDomainKey,
    permalinkMode: writing.permalinkMode,
  });

  if (existingPost) {
    const canonicalPath = buildDetailPath("post", decodedSlug, writing);
    if (canonicalPath !== `/${decodedSlug}`) {
      trace("routing", "core post redirect to canonical", {
        from: `/${decodedSlug}`,
        to: canonicalPath,
      });
      redirect(canonicalPath);
    }
  }

  if (!existingPost) {
    const candidateRows = await listSiteDataDomains(site.id as string, { includeInactive: true });

    const candidateWithSegments = await Promise.all(
      candidateRows.map(async (row) => {
        const configuredPermalink = await getSiteTextSetting(
          site.id as string,
          dataDomainPermalinkSettingKey(row.id),
          "",
        );
        const fallbackPermalink = String((row.settings as any)?.permalink || "").trim() || domainPluralSegment(row.key);
        const segment = normalizeDomainSegment(configuredPermalink || fallbackPermalink);
        return { ...row, segment };
      }),
    );

    const domainRow =
      candidateWithSegments.find(
        (row) =>
          Boolean(noDomainPrefixDomainKey) &&
          normalizeDomainSegment(row.key) === normalizeDomainSegment(String(noDomainPrefixDomainKey || "")),
      ) ||
      candidateWithSegments.find((row) => row.segment === normalizedSlug) ||
      candidateWithSegments.find((row) => isDomainArchiveSegment(normalizedSlug, row.key, row.label)) ||
      (singularFromSlug
        ? candidateWithSegments.find((row) => normalizeDomainSegment(row.key) === normalizeDomainSegment(singularFromSlug))
        : undefined);

    if (domainRow) {
      const isCoreDomain = DEFAULT_CORE_DOMAIN_KEYS.includes(
        domainRow.key as (typeof DEFAULT_CORE_DOMAIN_KEYS)[number],
      );
      const isAssignedToSite = true;
      if (!isCoreDomain && !isAssignedToSite) {
        notFound();
      }
      const siteScopedDescription = await getSiteTextSetting(
        site.id as string,
        dataDomainDescriptionSettingKey(domainRow.id),
        "",
      );
      const siteScopedLabel = (await getSiteTextSetting(
        site.id as string,
        dataDomainLabelSettingKey(domainRow.id),
        "",
      )).trim();
      const siteScopedKey = (await getSiteTextSetting(
        site.id as string,
        dataDomainKeySettingKey(domainRow.id),
        "",
      )).trim();
      const effectiveDomainKey = siteScopedKey || domainRow.key;
      const effectiveDomainLabel = siteScopedLabel || domainRow.label || effectiveDomainKey;
      const isPrimarySite = Boolean((site as any).isPrimary) || (site as any).subdomain === "main";
      const resolvedDomainDescription = resolveDataDomainDescription({
        domainKey: effectiveDomainKey,
        siteDescription: siteScopedDescription || (isPrimarySite ? (domainRow.description || "") : ""),
        globalDescription: domainRow.description || "",
      });
      const isMappedNoDomainArchive = Boolean(noDomainPrefixDomainKey);
      const matchesConfiguredArchiveSegment = normalizedSlug === normalizeDomainSegment(domainRow.segment);
      if (
        isMappedNoDomainArchive ||
        matchesConfiguredArchiveSegment ||
        isDomainArchiveSegment(normalizedSlug, domainRow.key, domainRow.label)
      ) {
        const incomingArchivePath = `/${decodedSlug}`;
        const canonicalArchivePath =
          writing.permalinkMode === "default"
            ? `/${domainRow.segment}`
            : buildArchivePath(domainRow.key, writing);
        if (incomingArchivePath !== canonicalArchivePath) {
          trace("routing", "domain archive redirect to canonical", {
            from: incomingArchivePath,
            to: canonicalArchivePath,
            dataDomain: domainRow.key,
          });
          redirect(canonicalArchivePath);
        }

        const entries = await getDomainPostsForSite(decodedDomain, domainRow.key);
        const isPrimary = Boolean((site as any).isPrimary) || (site as any).subdomain === "main";
        const configuredRootUrl = (await getSiteUrlSettingForSite(site.id as string, "")).value.trim();
        const derivedSiteUrl = getSitePublicUrl({
          subdomain: site.subdomain,
          customDomain: site.customDomain,
          isPrimary,
        });
        const siteUrl = configuredRootUrl || derivedSiteUrl;
        const rootUrl = getRootSiteUrl();
        const siteId = site.id as string;
        const kernel = await createKernelForRequest(site.id as string);
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
          const archiveCandidates = domainArchiveTemplateCandidates(domainRow.key, domainPluralSegment(domainRow.key));
          const pluginManaged = await isPluginManagedDataDomain(siteId, domainRow.key);
          const preferredArchiveCandidates = pluginManaged
            ? archiveCandidates.filter((candidate) => candidate !== "archive.html" && candidate !== "index.html")
            : archiveCandidates;
          trace("theme", "domain archive template candidates", {
            siteId,
            domainKey: domainRow.key,
            candidates: preferredArchiveCandidates,
          });
          const themeTemplate = await getThemeTemplateFromCandidates(
            siteId,
            preferredArchiveCandidates,
            {
              pluginDataDomain: domainRow.key,
              pluginCandidates: [
                `archive-${domainPluralSegment(domainRow.key)}.html`,
                `archive-${domainRow.key}.html`,
              ],
            },
          );
          if (themeTemplate) {
            const themeRuntime = await getThemeRenderContext(siteId, "domain_archive", [
              themeTemplate.template,
              themeTemplate.partials?.header,
              themeTemplate.partials?.footer,
            ]);
            const html = renderThemeTemplate(themeTemplate.template, {
              theme_header: themeTemplate.partials?.header || "",
              theme_footer: themeTemplate.partials?.footer || "",
              theme_menu: themeTemplate.partials?.menu || "",
              theme_menu_item: themeTemplate.partials?.menuItem || "",
              theme_menu_header: themeTemplate.partials?.menuByLocation?.header || "",
              theme_menu_footer: themeTemplate.partials?.menuByLocation?.footer || "",
              theme_menu_dashboard: themeTemplate.partials?.menuByLocation?.dashboard || "",
              theme_menu_item_header: themeTemplate.partials?.menuItemByLocation?.header || "",
              theme_menu_item_footer: themeTemplate.partials?.menuItemByLocation?.footer || "",
              theme_menu_item_dashboard: themeTemplate.partials?.menuItemByLocation?.dashboard || "",
              theme_menu_by_location: themeTemplate.partials?.menuByLocation || {},
              theme_menu_item_by_location: themeTemplate.partials?.menuItemByLocation || {},
              theme_menu_by_location_and_key: themeTemplate.partials?.menuByLocationAndKey || {},
              theme_menu_item_by_location_and_key: themeTemplate.partials?.menuItemByLocationAndKey || {},
              site: {
                id: site.id,
                name: site.name || "Tooty Site",
                description: site.description || "",
                subtitle: site.heroSubtitle || "",
                url: siteUrl,
                domain: siteUrl.replace(/^https?:\/\//, ""),
              },
              posts: entries.map((entry) => ({
                title: entry.title || "Untitled",
                description: entry.description || "",
                content: entry.content || "",
                slug: entry.slug,
                href: `${siteUrl.replace(/\/$/, "")}${buildDetailPath(domainRow.key, entry.slug, writing)}`,
                created_at: toDateString(entry.createdAt),
              })),
              links: {
                root: rootUrl,
                main_site: siteUrl,
                posts: `${siteUrl.replace(/\/$/, "")}${canonicalArchivePath}`,
                about: `${siteUrl.replace(/\/$/, "")}${buildDetailPath("page", "about-this-site", writing)}`,
                tos: `${siteUrl.replace(/\/$/, "")}${buildDetailPath("page", "terms-of-service", writing)}`,
                privacy: `${siteUrl.replace(/\/$/, "")}${buildDetailPath("page", "privacy-policy", writing)}`,
              },
              menu_items: menuItems,
              tooty: themeRuntime.tooty,
              auth: themeRuntime.auth,
              theme: {
                id: themeTemplate.themeId || "",
                name: themeTemplate.themeName || "",
                ...(themeTemplate.config || {}),
              },
              route_kind: "domain_archive",
              data_domain: effectiveDomainLabel,
              data_domain_label: effectiveDomainLabel,
              data_domain_key: effectiveDomainKey,
              data_domain_description: resolvedDomainDescription,
            });
            const hydratedHtml = hydrateCommentsSlotMarkup(
              html,
              await getPublicCommentCapabilities(siteId),
            );
            return <div className="tooty-theme-template" dangerouslySetInnerHTML={{ __html: hydratedHtml }} />;
          }
        }

        return (
          <main className="mx-auto min-h-screen w-full max-w-5xl px-5 pb-20 pt-12 text-[#f1dfc4]">
            <header className="rounded-xl border border-[#3b2b1e] bg-[#0f121b] p-6">
              <p className="text-sm uppercase tracking-[0.12em] text-[#bda17c]">All {pluralizeLabel(effectiveDomainLabel)}</p>
              <h1 className="mt-2 text-4xl font-semibold text-[#f3d7b2]">{pluralizeLabel(effectiveDomainLabel)}</h1>
              <p className="mt-3 text-[#cfb290]">All published {pluralizeLabel(effectiveDomainLabel).toLowerCase()} for this site.</p>
            </header>
            <section className="mt-5 grid gap-3">
              {entries.length === 0 ? (
                <article className="rounded-lg border border-[#3b2b1e] bg-[#0f121b] p-5 text-[#cfb290]">No entries yet.</article>
              ) : (
                entries.map((entry) => (
                  <article key={entry.id} className="rounded-lg border border-[#3b2b1e] bg-[#0f121b] p-5">
                    <Link
                      href={`${siteUrl.replace(/\/$/, "")}${buildDetailPath(domainRow.key, entry.slug, writing)}`}
                      className="text-2xl font-semibold text-[#f3d7b2] hover:underline"
                    >
                      {entry.title || "Untitled"}
                    </Link>
                    <p className="mt-1 text-sm text-[#c6ab87]">{toDateString(entry.createdAt)}</p>
                    {entry.description ? <p className="mt-2 text-[#d5b996]">{entry.description}</p> : null}
                  </article>
                ))
              )}
            </section>
          </main>
        );
      }
    }
  }
  const kernel = await createKernelForRequest(site.id as string);
  await kernel.doAction("content:load", { domain: decodedDomain, slug: decodedSlug });
  const data = existingPost;
  if (!data) {
    notFound();
  }
  const detailPath = buildDetailPath("post", decodedSlug, writing);
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
              <input type="hidden" name="returnTo" value={detailPath} />
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

  const layout = await kernel.applyFilters("render:layout", (data as any)?.layout ?? "post", {
    domain: decodedDomain,
    slug: decodedSlug,
  });
  const siteId = (data as any)?.site?.id as string | undefined;
  const baseHeaderMenu = siteId ? await getSiteMenu(siteId, "header") : [];
  const rawMenuItems = siteId
    ? await kernel.applyFilters("nav:items", baseHeaderMenu, {
        location: "header",
        domain: decodedDomain,
        siteId,
      })
    : [];
  const menuItems = normalizeMenuItemsForPermalinks(rawMenuItems, writing);
  const activeTheme = siteId ? await getActiveThemeForSite(siteId) : null;
  const documentationCategorySlug =
    typeof activeTheme?.config?.documentation_category_slug === "string" &&
    activeTheme.config.documentation_category_slug.trim().length > 0
      ? activeTheme.config.documentation_category_slug.trim().toLowerCase()
      : "documentation";
  const categoryRows =
    (data as any)?.id && siteId
      ? await (async () => {
          return withSiteTaxonomyTableRecovery(siteId, async () => {
            const { termsTable, termTaxonomiesTable, termRelationshipsTable } = getSiteTaxonomyTables(siteId);
            return db
              .select({ slug: termsTable.slug })
              .from(termRelationshipsTable)
              .innerJoin(termTaxonomiesTable, eq(termTaxonomiesTable.id, termRelationshipsTable.termTaxonomyId))
              .innerJoin(termsTable, eq(termsTable.id, termTaxonomiesTable.termId))
              .where(eq(termRelationshipsTable.objectId, (data as any).id));
          });
        })()
      : [];
  const categorySlugs = categoryRows
    .map((row) => row.slug)
    .filter((slug): slug is string => typeof slug === "string");
  const themeId = activeTheme?.id || "tooty-light";
  const isPrimary = Boolean((data as any)?.site?.isPrimary) || (data as any)?.site?.subdomain === "main";
  const configuredRootUrl = siteId ? (await getSiteUrlSettingForSite(siteId, "")).value.trim() : "";
  const derivedSiteUrl = getSitePublicUrl({
    subdomain: (data as any)?.site?.subdomain,
    customDomain: (data as any)?.site?.customDomain,
    isPrimary,
  });
  const siteUrl = configuredRootUrl || derivedSiteUrl;
  const rootUrl = getRootSiteUrl();
  const postMeta = Array.isArray((data as any)?.meta) ? ((data as any).meta as Array<{ key?: string; value?: string }>) : [];

  if (siteId) {
    const normalizedLayout = String(layout || "post").trim().toLowerCase();
    const themeTemplate =
      (await getThemeDetailTemplateByHierarchy(siteId, {
        dataDomain: "post",
        slug: decodedSlug,
      })) ||
      (await getThemeLayoutTemplateForSite(siteId, { layout: normalizedLayout })) ||
      (await getThemeTemplateFromCandidates(siteId, ["single.html", "index.html"]));
    if (themeTemplate) {
      const themeRuntime = await getThemeRenderContext(
        siteId,
        "domain_detail",
        [
          themeTemplate.template,
          themeTemplate.partials?.header,
          themeTemplate.partials?.footer,
        ],
        {
          kernel,
          slotContext: {
            entry: {
              id: (data as any)?.id || "",
              dataDomain: "post",
              meta: postMeta,
            },
          },
        },
      );
      const html = renderThemeTemplate(themeTemplate.template, {
        theme_header: themeTemplate.partials?.header || "",
        theme_footer: themeTemplate.partials?.footer || "",
        theme_menu: themeTemplate.partials?.menu || "",
        theme_menu_item: themeTemplate.partials?.menuItem || "",
        theme_menu_header: themeTemplate.partials?.menuByLocation?.header || "",
        theme_menu_footer: themeTemplate.partials?.menuByLocation?.footer || "",
        theme_menu_dashboard: themeTemplate.partials?.menuByLocation?.dashboard || "",
        theme_menu_item_header: themeTemplate.partials?.menuItemByLocation?.header || "",
        theme_menu_item_footer: themeTemplate.partials?.menuItemByLocation?.footer || "",
        theme_menu_item_dashboard: themeTemplate.partials?.menuItemByLocation?.dashboard || "",
        theme_menu_by_location: themeTemplate.partials?.menuByLocation || {},
        theme_menu_item_by_location: themeTemplate.partials?.menuItemByLocation || {},
        theme_menu_by_location_and_key: themeTemplate.partials?.menuByLocationAndKey || {},
        theme_menu_item_by_location_and_key: themeTemplate.partials?.menuItemByLocationAndKey || {},
        site: {
          id: (data as any)?.site?.id,
          name: (data as any)?.site?.name || "Tooty Site",
          description: (data as any)?.site?.description || "",
          subtitle: (data as any)?.site?.heroSubtitle || "",
          url: siteUrl,
          domain: siteUrl.replace(/^https?:\/\//, ""),
        },
        post: {
          id: (data as any)?.id || "",
          title: (data as any)?.title || "Untitled",
          description: (data as any)?.description || "",
          image: (data as any)?.image || "",
          slug: (data as any)?.slug || decodedSlug,
          href: `${siteUrl.replace(/\/$/, "")}${buildDetailPath("post", (data as any)?.slug || decodedSlug, writing)}`,
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
          about: `${siteUrl.replace(/\/$/, "")}${buildDetailPath("page", "about-this-site", writing)}`,
          tos: `${siteUrl.replace(/\/$/, "")}${buildDetailPath("page", "terms-of-service", writing)}`,
          privacy: `${siteUrl.replace(/\/$/, "")}${buildDetailPath("page", "privacy-policy", writing)}`,
        },
        menu_items: menuItems,
        tooty: themeRuntime.tooty,
        auth: themeRuntime.auth,
        theme: {
          id: themeTemplate.themeId || "",
          name: themeTemplate.themeName || "",
          ...(themeTemplate.config || {}),
        },
        route_kind: "domain_detail",
        data_domain: "post",
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
            dataDomainKey="post"
          />
        </>
      );
    }
  }

  const postData = {
    ...data,
    mdxSource: (data as any)?.mdxSource ?? (await getMdxSource((data as any)?.content || "")),
    layout,
    menuItems,
    categorySlugs,
    themeSlots: {} as Record<string, string>,
    primals: {
      public_image_base: `/theme-assets/${themeId}`,
      documentation_category_slug: documentationCategorySlug,
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
          dataDomain: "post",
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
        dataDomainKey="post"
      />
    </>
  );
}
