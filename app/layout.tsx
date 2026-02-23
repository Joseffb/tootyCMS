// app/layout.tsx
import "@/styles/globals.css";
import { cal, inter } from "@/styles/fonts";
import { Providers } from "./providers";
import { headers } from "next/headers";
import type { Metadata } from "next";
import { cn } from "@/lib/utils";
import AnalyticsConditional from "@/components/analytics-conditional";
import { getRootSiteUrl, isLocalHostLike } from "@/lib/site-url";
import { BotIdClient } from "botid/client";

const title = "Tooty CMS";
const description =
  "A multi-tenant vanilla CMS starter for blogs, docs, and content sites.";

function firstHeaderValue(raw: string | null) {
  if (!raw) return "";
  return raw.split(",")[0]?.trim() || "";
}

export async function generateMetadata(): Promise<Metadata> {
  const headerList = await headers();
  const fallbackOrigin = getRootSiteUrl().replace(/\/$/, "");
  const forwardedHost = firstHeaderValue(headerList.get("x-forwarded-host"));
  const host = forwardedHost || firstHeaderValue(headerList.get("host"));
  const forwardedProto = firstHeaderValue(headerList.get("x-forwarded-proto"));
  const protocol = forwardedProto || (isLocalHostLike(host) ? "http" : "https");
  const origin = host ? `${protocol}://${host}` : fallbackOrigin;
  const image = `${origin}/placeholder.png`;

  return {
    title,
    description,
    alternates: {
      canonical: origin,
    },
    icons: ["/icon.png"],
    openGraph: {
      title,
      description,
      url: origin,
      siteName: "Tooty CMS",
      images: [image],
      locale: "en_US",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
      creator: "@tootycms",
    },
    metadataBase: new URL(origin),
  };
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={cn(cal.variable, inter.variable)}>
        <BotIdClient
          protect={[
            { path: "/api/generate", method: "POST" },
            { path: "/api/uploadImage", method: "POST" },
          ]}
        />
        <AnalyticsConditional />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
