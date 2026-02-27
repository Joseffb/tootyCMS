import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getDomainPostsForSite, getPostData, getSiteData } from "@/lib/fetchers";
import SitePostContent from "./page-content";
import db from "@/lib/db";
import { eq } from "drizzle-orm";
import { dataDomains, termRelationships, termTaxonomies, terms } from "@/lib/schema"; // This is a client component.
import { createKernelForRequest } from "@/lib/plugin-runtime";
import { getSiteMenu } from "@/lib/menu-system";
import { getActiveThemeForSite, getThemeDetailTemplateByHierarchy, getThemeLayoutTemplateForSite, getThemeTemplateFromCandidates } from "@/lib/theme-runtime";
import { renderThemeTemplate } from "@/lib/theme-template";
import { toDateString } from "@/lib/utils";
import { getRootSiteUrl, getSitePublicUrl } from "@/lib/site-url";
import { getSiteUrlSettingForSite, getSiteWritingSettings } from "@/lib/cms-config";
import { toThemePostHtml } from "@/lib/theme-post-html";
import { parseGalleryMediaFromContent } from "@/lib/gallery-media";
import { pluralizeLabel } from "@/lib/data-domain-labels";
import { isDomainArchiveSegment, normalizeDomainKeyFromSegment, normalizeDomainSegment } from "@/lib/data-domain-routing";
import { domainArchiveTemplateCandidates } from "@/lib/theme-fallback";
import { buildArchivePath, buildDetailPath, domainPluralSegment, resolveNoDomainPrefixDomain } from "@/lib/permalink";
import { trace } from "@/lib/debug";
import { hasEnabledCommentProvider } from "@/lib/comments-spine";
import { hasPostPasswordAccess, requiresPostPasswordGate } from "@/lib/post-password";
import { getThemeRenderContext } from "@/lib/theme-render-context";

// We expect params to be a Promise resolving to an object with domain and slug.
type Params = Promise<{ domain: string; slug: string }>;

function readBooleanMeta(entries: Array<{ key?: string; value?: string }> | undefined, key: string, fallback = true) {
  const match = (entries || []).find((entry) => String(entry?.key || "").trim().toLowerCase() === key.toLowerCase());
  if (!match) return fallback;
  const normalized = String(match.value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(normalized)) return false;
  return fallback;
}

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
  const writing = await getSiteWritingSettings(site.id as string);
  const existingPost = await getPostData(decodedDomain, decodedSlug);
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

  if (!existingPost && (singularFromSlug || noDomainPrefixDomainKey)) {
    const domainKeyForArchive = noDomainPrefixDomainKey || singularFromSlug;
    if (!domainKeyForArchive) notFound();
    const domainRow = await db.query.dataDomains.findFirst({
      where: eq(dataDomains.key, domainKeyForArchive),
      columns: { key: true, label: true },
    });
    if (domainRow) {
      const isMappedNoDomainArchive = Boolean(noDomainPrefixDomainKey);
      if (isMappedNoDomainArchive || isDomainArchiveSegment(normalizedSlug, domainRow.key, domainRow.label)) {
        const incomingArchivePath = `/${decodedSlug}`;
        const canonicalArchivePath = buildArchivePath(domainRow.key, writing);
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
        const menuItems = siteId
          ? await kernel.applyFilters("nav:items", baseHeaderMenu, {
              location: "header",
              domain: decodedDomain,
              siteId,
            })
          : [];

        if (siteId) {
          const archiveCandidates = domainArchiveTemplateCandidates(domainRow.key, domainPluralSegment(domainRow.key));
          trace("theme", "domain archive template candidates", {
            siteId,
            domainKey: domainRow.key,
            candidates: archiveCandidates,
          });
          const themeTemplate = await getThemeTemplateFromCandidates(
            siteId,
            archiveCandidates,
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
                slug: entry.slug,
                href: `${siteUrl.replace(/\/$/, "")}${buildDetailPath(domainRow.key, entry.slug, writing)}`,
                created_at: toDateString(entry.createdAt),
              })),
              links: {
                root: rootUrl,
                main_site: siteUrl,
                posts: `${siteUrl.replace(/\/$/, "")}${buildArchivePath(domainRow.key, writing)}`,
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
              data_domain: domainRow.key,
            });
            return <div className="tooty-theme-template" dangerouslySetInnerHTML={{ __html: html }} />;
          }
        }

        return (
          <main className="mx-auto min-h-screen w-full max-w-5xl px-5 pb-20 pt-12 text-[#f1dfc4]">
            <header className="rounded-xl border border-[#3b2b1e] bg-[#0f121b] p-6">
              <p className="text-sm uppercase tracking-[0.12em] text-[#bda17c]">All {pluralizeLabel(domainRow.label)}</p>
              <h1 className="mt-2 text-4xl font-semibold text-[#f3d7b2]">{pluralizeLabel(domainRow.label)}</h1>
              <p className="mt-3 text-[#cfb290]">All published {pluralizeLabel(domainRow.label).toLowerCase()} for this site.</p>
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
  const commentsPluginEnabled = siteId ? await hasEnabledCommentProvider(siteId) : false;
  const commentsGateEnabled = commentsPluginEnabled && Boolean(writing.enableComments);
  const useComments = readBooleanMeta(postMeta, "use_comments", commentsGateEnabled);

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
      const themeRuntime = await getThemeRenderContext(siteId, "domain_detail", [
        themeTemplate.template,
        themeTemplate.partials?.header,
        themeTemplate.partials?.footer,
      ]);
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
          id: (data as any)?.id || "",
          title: (data as any)?.title || "Untitled",
          description: (data as any)?.description || "",
          slug: (data as any)?.slug || decodedSlug,
          href: `${siteUrl.replace(/\/$/, "")}${buildDetailPath("post", (data as any)?.slug || decodedSlug, writing)}`,
          created_at: (data as any)?.createdAt ? toDateString((data as any).createdAt) : "",
          layout,
          content_html: toThemePostHtml((data as any)?.content || ""),
          use_comments: useComments,
        },
        comments_enabled: commentsPluginEnabled,
        comments_gate_enabled: commentsGateEnabled,
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
      category_base: writing.categoryBase || "c",
      tag_base: writing.tagBase || "t",
    },
  };
  return <SitePostContent postData={postData} />;
}
