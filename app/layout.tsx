// app/layout.tsx
import "@/styles/globals.css";
import { cal, inter } from "@/styles/fonts";
import { Providers } from "./providers";
import { headers } from "next/headers";
import type { Metadata } from "next";
import { cn } from "@/lib/utils";
import AnalyticsConditional from "@/components/analytics-conditional";

const title = "Tooty CMS";
const description =
  "A multi-tenant vanilla CMS starter for blogs, docs, and content sites.";
const image = "https://your-domain.com/placeholder.png";

export async function generateMetadata(): Promise<Metadata> {
  const headerList = await headers();
  const host = headerList.get("host") || "your-domain.com";

  return {
    title,
    description,
    alternates: {
      canonical: `https://${host}`,
    },
    icons: ["/icon.png"],
    openGraph: {
      title,
      description,
      url: `https://${host}`,
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
    metadataBase: new URL(`https://${host}`),
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
        <AnalyticsConditional />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
