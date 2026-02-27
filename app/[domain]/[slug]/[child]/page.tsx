import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
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
import { hasEnabledCommentProvider } from "@/lib/comments-spine";
import { hasPostPasswordAccess, requiresPostPasswordGate } from "@/lib/post-password";
import { getThemeRenderContext } from "@/lib/theme-render-context";

type Params = Promise<{ domain: string; slug: string; child: string }>;

function readBooleanMeta(entries: Array<{ key?: string; value?: string }> | undefined, key: string, fallback = true) {
  const match = (entries || []).find((entry) => String(entry?.key || "").trim().toLowerCase() === key.toLowerCase());
  if (!match) return fallback;
  const normalized = String(match.value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(normalized)) return false;
  return fallback;
}

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
  const commentsEnabled = siteId ? await hasEnabledCommentProvider(siteId) : false;
  const commentsGateEnabled = commentsEnabled && Boolean(writing.enableComments);
  const postMeta = Array.isArray((data as any)?.meta) ? ((data as any).meta as Array<{ key?: string; value?: string }>) : [];
  const useComments = readBooleanMeta(postMeta, "use_comments", commentsGateEnabled);
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
      const themeRuntime = await getThemeRenderContext(siteId, "domain_detail", [
        themedTemplate.template,
        themedTemplate.partials?.header,
        themedTemplate.partials?.footer,
      ]);
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
          id: (data as any)?.id || "",
          title: (data as any)?.title || "Untitled",
          description: (data as any)?.description || "",
          slug: (data as any)?.slug || decodedSlug,
          href: `${siteUrl.replace(/\/$/, "")}${buildDetailPath(decodedDataDomain, (data as any)?.slug || decodedSlug, writing)}`,
          created_at: (data as any)?.createdAt ? toDateString((data as any).createdAt) : "",
          layout,
          content_html: toThemePostHtml((data as any)?.content || ""),
          use_comments: useComments,
        },
        comments_enabled: commentsEnabled,
        comments_gate_enabled: commentsGateEnabled,
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
      return <div className="tooty-theme-template" dangerouslySetInnerHTML={{ __html: html }} />;
    }
  }

  return (
    <SitePostContent
      postData={{
        ...(data as any),
        layout,
        menuItems,
        primals: {
          public_image_base: "",
          documentation_category_slug: "documentation",
          category_base: writing.categoryBase || "c",
          tag_base: writing.tagBase || "t",
        },
      }}
    />
  );
}
