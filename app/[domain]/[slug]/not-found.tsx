import { getSiteData } from "@/lib/fetchers";
import { headers } from "next/headers";
import Image from "next/image";
import { getThemeTemplateFromCandidates } from "@/lib/theme-runtime";
import { notFoundTemplateCandidates } from "@/lib/theme-fallback";
import { renderThemeTemplate } from "@/lib/theme-template";
import { getRootSiteUrl, getSitePublicUrl } from "@/lib/site-url";
import { getSiteUrlSettingForSite, getSiteWritingSettings } from "@/lib/cms-config";
import { buildDetailPath } from "@/lib/permalink";

export default async function NotFound() {
  const headersList = await headers();
  const forwardedHost = headersList.get("x-forwarded-host");
  const host = (forwardedHost || headersList.get("host") || "").split(",")[0]?.trim() || "";
  const data = host ? await getSiteData(host) : null;
  const siteId = data?.id as string | undefined;
  const rootUrl = getRootSiteUrl();

  if (siteId) {
    const [themeTemplate, configuredRootUrl, writing] = await Promise.all([
      getThemeTemplateFromCandidates(siteId, notFoundTemplateCandidates()),
      getSiteUrlSettingForSite(siteId, ""),
      getSiteWritingSettings(siteId),
    ]);
    if (themeTemplate) {
      const isPrimary = Boolean(data?.isPrimary) || data?.subdomain === "main";
      const siteUrl =
        configuredRootUrl.value.trim() ||
        getSitePublicUrl({
          subdomain: data?.subdomain,
          customDomain: data?.customDomain,
          isPrimary,
        });
      const html = renderThemeTemplate(themeTemplate.template, {
        theme_header: themeTemplate.partials?.header || "",
        theme_footer: themeTemplate.partials?.footer || "",
        site: {
          id: data?.id || "",
          name: data?.name || "Tooty Site",
          description: data?.description || "",
          subtitle: data?.heroSubtitle || "",
          url: siteUrl,
          domain: siteUrl.replace(/^https?:\/\//, ""),
        },
        post: {
          title: `404${data?.name ? ` - ${data.name}` : ""}`,
          description: data?.message404 || "Page not found",
          slug: "404",
          href: "",
          created_at: "",
          layout: "404",
          content_html: data?.message404 || "Page not found",
        },
        links: {
          root: rootUrl,
          main_site: siteUrl,
          about: `${siteUrl.replace(/\/$/, "")}${buildDetailPath("page", "about-this-site", writing)}`,
          tos: `${siteUrl.replace(/\/$/, "")}${buildDetailPath("page", "terms-of-service", writing)}`,
          privacy: `${siteUrl.replace(/\/$/, "")}${buildDetailPath("page", "privacy-policy", writing)}`,
        },
        route_kind: "not_found",
        data_domain: "404",
      });
      return <div className="tooty-theme-template" dangerouslySetInnerHTML={{ __html: html }} />;
    }
  }

  return (
    <main className="tooty-archive-shell flex min-h-screen items-center justify-center px-5 py-12">
      <section className="tooty-archive-card w-full max-w-2xl rounded-2xl border p-8 text-center">
        <h1 className="tooty-post-title font-cal text-4xl">{data ? `${data.name}: ` : ""}404</h1>
        <div className="mx-auto mt-4 w-fit overflow-hidden rounded-xl">
          <Image
            alt="missing site"
            src="https://illustrations.popsy.co/gray/timed-out-error.svg"
            width={360}
            height={360}
          />
        </div>
        <p className="tooty-post-description mt-4 text-lg">
          {data
            ? data.message404
            : "Blimey! You've found a page that doesn't exist."}
        </p>
      </section>
    </main>
  );
}
