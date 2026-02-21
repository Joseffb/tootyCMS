import Link from "next/link";
import { notFound } from "next/navigation";
import { getPostsForSite, getSiteData } from "@/lib/fetchers";
import { toDateString } from "@/lib/utils";
import { getRootSiteUrl, getSitePublicUrl } from "@/lib/site-url";
import { getSiteUrlSetting } from "@/lib/cms-config";
import { getThemeTemplateFromCandidates } from "@/lib/theme-runtime";
import { renderThemeTemplate } from "@/lib/theme-template";

type Params = Promise<{ domain: string }>;

export default async function SitePostsPage({ params }: { params: Params }) {
  const { domain } = await params;
  const decodedDomain = decodeURIComponent(domain);
  const [site, posts] = await Promise.all([getSiteData(decodedDomain), getPostsForSite(decodedDomain)]);

  if (!site) {
    notFound();
  }

  const isPrimary = Boolean((site as any).isPrimary) || (site as any).subdomain === "main";
  const configuredRootUrl = isPrimary ? (await getSiteUrlSetting()).value.trim() : "";
  const derivedSiteUrl = getSitePublicUrl({
    subdomain: site.subdomain,
    customDomain: site.customDomain,
    isPrimary,
  });
  const siteUrl = configuredRootUrl || derivedSiteUrl;
  const rootUrl = getRootSiteUrl();
  const siteId = site.id as string;

  if (siteId) {
    const themedTemplate = await getThemeTemplateFromCandidates(siteId, [
      "posts.html",
      "archive-posts.html",
      "archive.html",
    ]);
    if (themedTemplate) {
      const html = renderThemeTemplate(themedTemplate.template, {
        theme_header: themedTemplate.partials?.header || "",
        theme_footer: themedTemplate.partials?.footer || "",
        site: {
          id: site.id,
          name: site.name || "Tooty Site",
          description: site.description || "",
          subtitle: site.heroSubtitle || "",
          url: siteUrl,
          domain: siteUrl.replace(/^https?:\/\//, ""),
        },
        posts: posts.map((post) => ({
          title: post.title || "Untitled",
          description: post.description || "",
          slug: post.slug,
          href: `${siteUrl.replace(/\/$/, "")}/${post.slug}`,
          created_at: toDateString(post.createdAt),
        })),
        links: {
          root: rootUrl,
          main_site: siteUrl,
          posts: `${siteUrl.replace(/\/$/, "")}/posts`,
        },
        route_kind: "post_archive",
        data_domain: "post",
      });
      return <div className="tooty-theme-template" dangerouslySetInnerHTML={{ __html: html }} />;
    }
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-5 pb-20 pt-12 text-[#f1dfc4]">
      <header className="rounded-xl border border-[#3b2b1e] bg-[#0f121b] p-6">
        <p className="text-sm uppercase tracking-[0.12em] text-[#bda17c]">All Posts</p>
        <h1 className="mt-2 text-4xl font-semibold text-[#f3d7b2]">Latest Thinking</h1>
        <p className="mt-3 text-[#cfb290]">All published posts for this site.</p>
      </header>

      <section className="mt-5 grid gap-3">
        {posts.length === 0 ? (
          <article className="rounded-lg border border-[#3b2b1e] bg-[#0f121b] p-5 text-[#cfb290]">No posts yet.</article>
        ) : (
          posts.map((post) => (
            <article key={post.slug} className="rounded-lg border border-[#3b2b1e] bg-[#0f121b] p-5">
              <Link
                href={`${siteUrl.replace(/\/$/, "")}/${post.slug}`}
                className="text-2xl font-semibold text-[#f3d7b2] hover:underline"
              >
                {post.title}
              </Link>
              <p className="mt-1 text-sm text-[#c6ab87]">{toDateString(post.createdAt)}</p>
              {post.description ? <p className="mt-2 text-[#d5b996]">{post.description}</p> : null}
            </article>
          ))
        )}
      </section>
    </main>
  );
}
