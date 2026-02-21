import Link from "next/link";
import { notFound } from "next/navigation";
import BlurImage from "@/components/blur-image";
import { placeholderBlurhash, toDateString } from "@/lib/utils";
import BlogCard from "@/components/blog-card";
import { getPostsForSite, getSiteData } from "@/lib/fetchers";
import Image from "next/image";
import db from "@/lib/db";
import { getThemeTemplateForSite } from "@/lib/theme-runtime";
import { renderThemeTemplate } from "@/lib/theme-template";
import { getRootSiteUrl, getSitePublicUrl } from "@/lib/site-url";
import { getInstallState } from "@/lib/install-state";
import { getThemeContextApi } from "@/lib/extension-api";
import { getWritingSettings } from "@/lib/cms-config";

// Type Definitions
interface SeriesLink {
  title: string;
  description: string;
  cover: string;
  status: string;
  url: string;
}

interface Panel {
  id: number;
  title: string;
  bgImage: string;
  content: string;
  status: string;
  series_links: SeriesLink[];
}

interface Data {
  heroTitle: string;
  heroSubtitle: string;
  heroImage: string;
  imageBlurhash: string;
  heroCtaText: string;
  heroCtaUrl: string;
  seriesCards: Panel[];
}


export async function generateStaticParams() {
  const allSites = await db.query.sites.findMany({
    columns: { subdomain: true, customDomain: true },
  });

  return allSites
    .flatMap(({ subdomain, customDomain }) => [
      subdomain && {
        domain: `${subdomain}.${process.env.NEXT_PUBLIC_ROOT_DOMAIN}`,
      },
      customDomain && {
        domain: customDomain,
      },
    ])
    .filter(Boolean);
}
interface Panel {
  id: number;
  title: string;
  bgImage: string;
  content: string;
  status: string;
  series_links: {
    title: string;
    description: string;
    cover: string;
    status: string;
    url: string;
  }[];
}

type Params = Promise<{ domain: string }>;

export default async function SiteHomePage({ params }: { params: Params }) {
  const { domain } = await params;
  const decodedDomain = decodeURIComponent(domain);

  // Fetch site data and posts concurrently
  const [data, posts] = await Promise.all([
    getSiteData(decodedDomain),
    getPostsForSite(decodedDomain),
  ]);

  if (!data) notFound();

  // Parsing the stringified seriesCards to an actual array
  // Check if data.seriesCards is a string and needs parsing
  let PANELS;

  if (typeof data.seriesCards === "string") {
    try {
      PANELS = JSON.parse(data.seriesCards);
    } catch (error) {
      console.error("Error parsing seriesCards:", error);
      PANELS = [];
    }
  } else {
    PANELS = data.seriesCards || [];
  }
  const themedTemplate = await getThemeTemplateForSite(data.id as string, "home");
  if (themedTemplate) {
    const rootUrl = getRootSiteUrl();
    const installState = await getInstallState();
    const themeApi = await getThemeContextApi(data.id as string);
    const writingSettings = await getWritingSettings();
    const siteUrl = getSitePublicUrl({
      subdomain: data.subdomain,
      customDomain: data.customDomain,
      isPrimary: Boolean((data as any).isPrimary) || (data as any).subdomain === "main",
    });
    const themePosts = posts.map((post: any) => ({
      title: post.title || "Untitled",
      description: post.description || "",
      href: `${siteUrl.replace(/\/$/, "")}/${post.slug}`,
      created_at: toDateString(post.createdAt),
      slug: post.slug,
    }));
    const newestPost = themePosts[0] || null;

    const html = renderThemeTemplate(themedTemplate.template, {
      theme_header: themedTemplate.partials?.header || "",
      theme_footer: themedTemplate.partials?.footer || "",
      site: {
        id: data.id,
        name: data.name || "Tooty Site",
        domain: siteUrl.replace(/^https?:\/\//, ""),
        description: data.description || "",
        subtitle: data.heroSubtitle || "",
        url: siteUrl,
      },
      hero: {
        title: data.heroTitle || data.name || "Tooty CMS",
        subtitle: data.heroSubtitle || data.description || "",
        cta_text: data.heroCtaText || "Explore",
        cta_url: data.heroCtaUrl || "#",
      },
      posts: themePosts,
      newest_post: newestPost,
      panels: PANELS,
      theme: {
        id: themedTemplate.themeId || "",
        name: themedTemplate.themeName || "",
        ...(themedTemplate.config || {}),
      },
      tooty: themeApi,
      links: {
        root: rootUrl,
        main_site: siteUrl,
        documentation: `${siteUrl}/c/documentation`,
        setup: installState.setupRequired ? `${rootUrl}/setup` : "",
      },
      route_kind: "home",
      data_domain: "post",
      category_base: writingSettings.categoryBase || "c",
      tag_base: writingSettings.tagBase || "t",
    });

    return (
      <div
        className="tooty-theme-template"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  return (
    <>
      {/* Hero Section */}
      {data.heroTitle && (
        <div className="relative h-[70vh] mt-20 w-full overflow-hidden">
          <div className="relative h-full w-full overflow-hidden">
            {data.heroImage ? (
              <BlurImage
                alt={posts[0]?.title ?? ""}
                blurDataURL={data.imageBlurhash ?? placeholderBlurhash}
                className="h-full w-full object-cover object-center"
                src={data.heroImage ?? "/placeholder.png"}
                width={1920}
                height={1080}
                placeholder="blur"
              />
            ) : (
              <BlurImage
                alt="Hero Image"
                blurDataURL= {placeholderBlurhash}
                className="h-full w-full object-cover object-center"
                src={`/${data.subdomain}_heroImage.png`} // Dynamic image based on domain
                width={1920}
                height={1080}
                placeholder="blur"
              />
            )}
            <div className="absolute inset-0 bg-black/60 flex flex-col justify-end px-10 pb-20 text-white">
              <h1 className="text-4xl md:text-6xl font-bold max-w-4xl">
                {data.heroTitle}
              </h1>
              <p className="mt-3 max-w-2xl text-lg md:text-xl text-stone-300">
                {data.heroSubtitle}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* CTA + Series Links */}
      <div className="bg-black text-white text-center py-6 text-lg font-semibold">
        {data.heroCtaText}
      </div>

      {/* Render Panels */}
      {PANELS.length > 0 ? (
        PANELS.map((panel: any) => (
          <section key={panel.id} className="relative z-[99999] py-3 px-4 sm:px-8 md:px-12 lg:px-20 bg-black text-white">            <div className="mx-auto max-w-screen-xl">
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-2">
                {panel.series_links && panel.series_links.length > 0 ? (
                  panel.series_links.map((link:any, index:number) => (
                    <div
                      key={index}
                      className="relative flex items-start gap-4 overflow-hidden rounded-lg bg-zinc-900/80 p-4 transition-all duration-300 hover:bg-zinc-800 shadow-lg group"
                    >
                      <Image
                        src={`/${link.cover}`}
                        alt={link.title}
                        width={80}
                        height={120}
                        className="w-20 h-auto rounded shadow object-cover"
                        unoptimized
                      />
                      <div>
                        <h3 className="text-lg font-semibold mb-1">
                          {link.title.replace(/[_\-\.]/g, " ")}
                        </h3>
                        <p className="text-sm leading-snug text-white/80 line-clamp-3 group-hover:line-clamp-none transition-all">
                          {link.description}
                        </p>
                        <p className="text-[11px] uppercase tracking-wider font-medium text-white/60 mt-2">
                          Status: {link.status}
                        </p>
                        {link.url ? (
                          <a
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-block mt-1 text-xs text-teal-400 underline underline-offset-2 hover:text-teal-300"
                          >
                            {new URL(link.url).hostname.replace("www.", "")}
                          </a>
                        ) : (
                          <span className="text-xs italic text-white/50 mt-1 block">
                      Coming soon
                    </span>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-center text-white/50">No series available</p>
                )}
              </div>
            </div>
          </section>
        ))
      ) : null}

      {/* Card Grid Section */}
      <div className="relative -mt-24 z-20 mx-auto max-w-screen-xl px-6 pb-24 pt-32">
        <h2 className="mb-10 text-3xl md:text-5xl font-title dark:text-white">
          More from This Universe
        </h2>
        <div className="grid grid-cols-1 gap-10 md:grid-cols-2 lg:grid-cols-3">
          {posts.length > 0 ? (
            posts.slice(0).map((metadata: any, index: number) => (
              <BlogCard key={index} data={metadata} />
            ))
          ) : (
            <div className="col-span-full text-center text-lg text-stone-500">
              No posts available. Stay tuned for new posts!
            </div>
          )}
        </div>
      </div>
    </>
  );
}
