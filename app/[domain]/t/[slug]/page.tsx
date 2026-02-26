import Link from "next/link";
import { notFound } from "next/navigation";
import { toDateString } from "@/lib/utils";
import { getSiteData, getTaxonomyArchiveData } from "@/lib/fetchers";
import { getRootSiteUrl, getSitePublicUrl } from "@/lib/site-url";
import { getActiveThemeForSite, getThemeTemplateByHierarchy } from "@/lib/theme-runtime";
import { renderThemeTemplate } from "@/lib/theme-template";
import { getSiteUrlSettingForSite, getSiteWritingSettings } from "@/lib/cms-config";
import { buildDetailPath } from "@/lib/permalink";

type Params = Promise<{ domain: string; slug: string }>;

export default async function TagArchivePage({ params }: { params: Params }) {
  const { domain, slug } = await params;
  const decodedDomain = decodeURIComponent(domain);
  const decodedSlug = decodeURIComponent(slug);
  const site = await getSiteData(decodedDomain);
  if (!site) notFound();
  const writing = await getSiteWritingSettings(site.id);
  const taxonomyDomainKey = writing.noDomainDataDomain || "post";
  const data = await getTaxonomyArchiveData(
    decodedDomain,
    "tag",
    decodedSlug,
    taxonomyDomainKey,
  );
  if (!data) notFound();
  const activeTheme = site?.id ? await getActiveThemeForSite(site.id) : null;
  const documentationCategorySlug =
    typeof activeTheme?.config?.documentation_category_slug === "string" &&
    activeTheme.config.documentation_category_slug.trim().length > 0
      ? activeTheme.config.documentation_category_slug.trim().toLowerCase()
      : "documentation";
  const themeId = activeTheme?.id || "tooty-light";
  const rootUrl = getRootSiteUrl();
  const isPrimary = Boolean(site?.isPrimary) || site?.subdomain === "main";
  const configuredRootUrl = (await getSiteUrlSettingForSite(site.id, "")).value.trim();
  const derivedSiteUrl = getSitePublicUrl({
    subdomain: site.subdomain || decodedDomain.split(".")[0] || "main",
    customDomain: site.customDomain,
    isPrimary,
  });
  const siteUrl = configuredRootUrl || derivedSiteUrl;

  if (site?.id) {
    const tagTemplate = await getThemeTemplateByHierarchy(site.id, {
        taxonomy: "tag",
        slug: decodedSlug,
        dataDomain: taxonomyDomainKey,
      });
    if (tagTemplate) {
      const html = renderThemeTemplate(tagTemplate.template, {
        theme_header: tagTemplate.partials?.header || "",
        theme_footer: tagTemplate.partials?.footer || "",
        site: {
          id: site.id,
          name: site.name || "Tooty CMS",
          description: site.description || "",
          subtitle: site.heroSubtitle || "",
          url: siteUrl,
        },
        term: {
          slug: decodedSlug,
          name: data.term.name,
        },
        posts: data.posts.map((post) => ({
          title: post.title,
          description: post.description || "",
          href: `${siteUrl}${buildDetailPath(taxonomyDomainKey, post.slug, writing)}`,
          created_at: toDateString(post.createdAt),
        })),
        links: {
          root: rootUrl,
          main_site: siteUrl,
          documentation: `${siteUrl}/c/documentation`,
          about: `${siteUrl.replace(/\/$/, "")}${buildDetailPath("page", "about-this-site", writing)}`,
          tos: `${siteUrl.replace(/\/$/, "")}${buildDetailPath("page", "terms-of-service", writing)}`,
          privacy: `${siteUrl.replace(/\/$/, "")}${buildDetailPath("page", "privacy-policy", writing)}`,
        },
      });
      return <div className="tooty-theme-template" dangerouslySetInnerHTML={{ __html: html }} />;
    }
  }

  return (
    <main
      className="tooty-archive-shell min-h-screen pb-20"
      data-theme-context="1"
      data-theme-route-kind="tag_archive"
      data-theme-term-slug={decodedSlug}
      data-theme-doc-category-slug={documentationCategorySlug}
      data-theme-public-image-base={`/theme-assets/${themeId}`}
    >
      <section className="mx-auto w-full max-w-6xl px-5 pt-6 md:px-8">
        <div className="tooty-post-nav flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 shadow-sm backdrop-blur">
          <a href={rootUrl} className="tooty-post-link text-sm font-semibold tracking-[0.08em] hover:underline">
            {site?.name || "Tooty CMS"}
          </a>
          <div className="tooty-post-nav-links flex flex-wrap items-center gap-4 text-sm">
            <a href={siteUrl} className="tooty-post-link hover:underline">
              Main Site
            </a>
            <Link href="/c/documentation" className="tooty-post-link hover:underline">
              Documentation
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto mt-5 w-full max-w-6xl px-5 md:px-8">
        <div className="tooty-archive-hero relative overflow-hidden rounded-[1.8rem] border p-6 shadow-sm md:p-9">
          <p className="tooty-post-badge inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em]">
            Tag Archive
          </p>
          <div className="mt-4 grid items-center gap-6 md:grid-cols-[1.2fr_0.8fr]">
            <div>
              <h1 className="tooty-post-title max-w-3xl text-balance font-cal text-4xl font-bold leading-[1.05] md:text-6xl">
                {data.term.name}
              </h1>
              <p className="tooty-post-description mt-4 max-w-3xl text-lg font-medium md:text-xl">
                {data.posts.length} published {data.posts.length === 1 ? "post" : "posts"} with this tag.
              </p>
            </div>
            <div data-theme-slot="header-art" className="theme-header-art-slot" />
          </div>
        </div>
      </section>

      <section className="mx-auto mt-8 w-full max-w-4xl px-5 md:px-8">
        <div className="grid gap-4">
          {data.posts.map((post) => (
            <article key={post.slug} className="tooty-archive-card rounded-xl border p-4">
              <Link href={buildDetailPath(taxonomyDomainKey, post.slug, writing)} className="tooty-post-title font-semibold hover:underline">
                {post.title}
              </Link>
              <p className="tooty-post-meta mt-1 text-sm">{toDateString(post.createdAt)}</p>
              {post.description ? <p className="tooty-archive-description mt-2 text-sm">{post.description}</p> : null}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
