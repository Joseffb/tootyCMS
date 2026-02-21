"use client";

import dynamic from "next/dynamic";
import { toDateString } from "@/lib/utils";
import GalleryLayout from "@/components/layouts/gallery-layout";
import { getRootSiteUrl, getSitePublicUrl } from "@/lib/site-url";
import Link from "next/link";

const MDX = dynamic(() => import("@/components/mdx"), { ssr: false });

export default function SitePostContent({ postData }: { postData: any }) {
  const rootUrl = getRootSiteUrl();
  const siteUrl = getSitePublicUrl({
    subdomain: postData?.site?.subdomain,
    customDomain: postData?.site?.customDomain,
    isPrimary: postData?.site?.isPrimary || postData?.site?.subdomain === "main",
  });

  const activeLayout = postData.layout ?? "post";
  const isPageLayout = activeLayout === "page";

  const renderLayout = () => {
    switch (activeLayout) {
      case "gallery":
        return <GalleryLayout postData={postData} />;
      default:
        return <MDX source={postData.mdxSource} />;
    }
  };

  return (
    <main
      className="tooty-post-shell min-h-screen pb-20"
      data-theme-context="1"
      data-theme-route-kind={isPageLayout ? "page_detail" : "post_detail"}
      data-theme-category-slugs={Array.isArray(postData?.categorySlugs) ? postData.categorySlugs.join(",") : ""}
      data-theme-doc-category-slug={postData?.primals?.documentation_category_slug || "documentation"}
      data-theme-public-image-base={postData?.primals?.public_image_base || ""}
    >
      <section className="mx-auto w-full max-w-6xl px-5 pt-6 md:px-8">
        <div className="tooty-post-nav flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 shadow-sm backdrop-blur">
          <a href={rootUrl} className="tooty-post-link text-sm font-semibold tracking-[0.08em] hover:underline">
            {postData?.site?.name || "Site"}
          </a>
          <div className="tooty-post-nav-links flex flex-wrap items-center gap-4 text-sm">
            {Array.isArray(postData?.menuItems) && postData.menuItems.length > 0 ? (
              postData.menuItems.map((item: any) =>
                item?.external ? (
                  <a key={`${item.href}-${item.label}`} href={item.href} target="_blank" rel="noreferrer" className="tooty-post-link hover:underline">
                    {item.label}
                  </a>
                ) : (
                  <Link key={`${item.href}-${item.label}`} href={item.href} className="tooty-post-link hover:underline">
                    {item.label}
                  </Link>
                ),
              )
            ) : (
              <>
                <a href={siteUrl} className="tooty-post-link hover:underline">
                  Main Site
                </a>
                <Link href="/c/documentation" className="tooty-post-link hover:underline">
                  Documentation
                </Link>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="mx-auto mt-5 w-full max-w-6xl px-5 md:px-8">
        <div className={`tooty-post-hero relative overflow-hidden rounded-[1.8rem] border p-6 shadow-sm md:p-9 ${isPageLayout ? "tooty-post-hero--page" : "tooty-post-hero--post"}`}>
          <p className="tooty-post-badge inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em]">
            {isPageLayout ? "Page" : "Post"}
          </p>
          <div className={`mt-4 grid items-center gap-6 ${isPageLayout ? "md:grid-cols-1" : "md:grid-cols-[1.2fr_0.8fr]"}`}>
            <div>
              <h1 className="tooty-post-title max-w-3xl text-balance font-cal text-4xl font-bold leading-[1.05] md:text-6xl">
                {postData.title}
              </h1>
              {!isPageLayout ? (
                <p className="tooty-post-meta mt-3 text-sm font-semibold md:text-base">
                  {toDateString(postData.createdAt)}
                </p>
              ) : null}
              {postData.description && (
                <p className="tooty-post-description mt-4 max-w-3xl text-lg font-medium md:text-xl">
                  {postData.description}
                </p>
              )}
            </div>
            {!isPageLayout ? <div data-theme-slot="header-art" className="theme-header-art-slot" /> : null}
          </div>
        </div>
      </section>

      <section className="mx-auto mt-8 w-full max-w-4xl px-5 md:px-8">
        <div className="tooty-post-body rounded-[1.6rem] border p-6 shadow-sm md:p-10">
          <div className="tooty-post-prose prose max-w-none prose-lg">
            {renderLayout()}
          </div>
        </div>
      </section>
    </main>
  );
}
