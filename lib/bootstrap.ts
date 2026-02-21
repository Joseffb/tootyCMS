import { getSession } from "@/lib/auth";
import db from "@/lib/db";
import { posts, sites } from "@/lib/schema";
import { isRandomDefaultImagesEnabled } from "@/lib/cms-config";
import { and, eq, isNull } from "drizzle-orm";

const PRIMARY_SUBDOMAIN = "main";
const DEFAULT_SITE_THUMBNAIL = "/tooty/sprites/tooty-thumbs-up-cropped.png";
const WELCOME_POST_THUMBNAIL = "/tooty/sprites/tooty-laptop.png";
const WELCOME_MARKETING_COPY = `# Welcome to Tooty CMS

Tooty CMS helps teams ship content fast without sacrificing control, quality, or developer sanity.

## Built for Modern Content Operations

- Write, edit, and publish from one workflow.
- Keep URLs and taxonomy predictable across teams.
- Scale from one site to multi-site without rebuilding the stack.

## Why Teams Move to Tooty

- Too many CMS platforms become plugin archaeology projects.
- Tooty stays simple: clear primitives, fast UI, stable contracts.
- Your team spends time shipping content, not debugging fragile admin flows.

## What You Can Launch

- Product marketing sites.
- Documentation hubs and knowledge bases.
- Changelogs, release notes, and announcements.
- Editorial blogs and campaign landing pages.

## Editorial Speed, Engineering Control

- Editors get a focused writing experience with practical publishing defaults.
- Developers get theme-level control and canonical runtime context.
- Teams get a shared system that stays understandable as scope grows.

## Platform Highlights

- HTML/CSS-first theme model.
- Data domain aware template context.
- Global system primaries available in templates.
- Site-level menu control with safe defaults.
- Media manager workflow built for reuse.

## Your First Week with Tooty

1. Publish your first hero post.
2. Set category and tag strategy.
3. Configure navigation and key routes.
4. Align theme output to your domain model.
5. Build an editorial checklist your team can repeat.

If your team cares about speed, clarity, and long-term maintainability, Tooty CMS gives you a production-ready foundation from day one.`;

async function ensurePrimarySiteUsesMainSubdomain(primarySiteId: string) {
  const mainTakenByOther = await db.query.sites.findFirst({
    where: (table, { and, eq, ne }) =>
      and(eq(table.subdomain, PRIMARY_SUBDOMAIN), ne(table.id, primarySiteId)),
    columns: { id: true },
  });
  if (!mainTakenByOther) {
    await db
      .update(sites)
      .set({ subdomain: PRIMARY_SUBDOMAIN })
      .where(eq(sites.id, primarySiteId));
  }
}

function starterPostContent(text: string) {
  return JSON.stringify({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text }],
      },
    ],
  });
}

function galleryStarterContent() {
  return JSON.stringify({
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2, textAlign: null },
        content: [{ type: "text", text: "Media Showcase" }],
      },
      {
        type: "paragraph",
        attrs: { textAlign: null },
        content: [{ type: "text", text: "This gallery demonstrates image, video, and social links." }],
      },
      {
        type: "image",
        attrs: {
          src: "/tooty/sprites/tooty-camera.png",
          alt: "Gallery example image",
          title: null,
          width: null,
          height: null,
        },
      },
      {
        type: "paragraph",
        attrs: { textAlign: null },
        content: [{ type: "text", text: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }],
      },
      {
        type: "paragraph",
        attrs: { textAlign: null },
        content: [{ type: "text", text: "https://x.com/vercel" }],
      },
    ],
  });
}

type TiptapNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  text?: string;
};

function markdownToStarterDoc(markdown: string) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const content: TiptapNode[] = [];
  let paragraphBuffer: string[] = [];
  let listBuffer: string[] = [];

  const flushParagraph = () => {
    const text = paragraphBuffer.join(" ").trim();
    if (!text) return;
    content.push({
      type: "paragraph",
      attrs: { textAlign: null },
      content: [{ type: "text", text }],
    });
    paragraphBuffer = [];
  };

  const flushList = () => {
    if (!listBuffer.length) return;
    content.push({
      type: "bulletList",
      content: listBuffer.map((item) => ({
        type: "listItem",
        content: [
          {
            type: "paragraph",
            attrs: { textAlign: null },
            content: [{ type: "text", text: item }],
          },
        ],
      })),
    });
    listBuffer = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      content.push({
        type: "heading",
        attrs: { level, textAlign: null },
        content: [{ type: "text", text }],
      });
      continue;
    }
    const listMatch = line.match(/^[-*]\s+(.+)$/);
    if (listMatch) {
      flushParagraph();
      listBuffer.push(listMatch[1].trim());
      continue;
    }
    paragraphBuffer.push(line);
  }

  flushParagraph();
  flushList();

  return JSON.stringify({
    type: "doc",
    content: content.length
      ? content
      : [
          {
            type: "paragraph",
            attrs: { textAlign: null },
            content: [{ type: "text", text: "Documentation coming soon." }],
          },
        ],
  });
}

async function ensureSeedSiteThumbnail(siteId: string) {
  const site = await db.query.sites.findFirst({
    where: eq(sites.id, siteId),
    columns: { image: true },
  });
  if (!site || site.image) return;
  await db.update(sites).set({ image: DEFAULT_SITE_THUMBNAIL }).where(eq(sites.id, siteId));
}

async function removeLegacyDocumentationPost(siteId: string) {
  await db.delete(posts).where(and(eq(posts.siteId, siteId), eq(posts.slug, "documentation")));
}

async function ensureDefaultStarterPosts(siteId: string, userId: string, useRandomDefaultImages: boolean) {
  await db
    .insert(posts)
    .values([
    {
      siteId,
      userId,
      title: "Theme Guide: HTML + CSS First",
      description: "Tooty themes are plain HTML/CSS + React components.",
      ...(useRandomDefaultImages ? { image: DEFAULT_SITE_THUMBNAIL } : {}),
      content: starterPostContent(
        "Use semantic HTML, utility CSS, and component-level styling. Keep it simple, fast, and deployable on Vercel.",
      ),
      layout: "post",
      slug: "theme-guide-html-css-first",
      published: true,
    },
    {
      siteId,
      userId,
      title: "About This Site",
      description: "A simple page-layout example you can edit or delete.",
      ...(useRandomDefaultImages ? { image: "/tooty/sprites/tooty-notebook.png" } : {}),
      content: starterPostContent(
        "This is a default page layout example. Use it for About, Contact, or evergreen site information.",
      ),
      layout: "page",
      slug: "about-this-site",
      published: true,
    },
    {
      siteId,
      userId,
      title: "Gallery Showcase",
      description: "A default gallery layout example powered by editor media.",
      ...(useRandomDefaultImages ? { image: "/tooty/sprites/tooty-camera.png" } : {}),
      content: galleryStarterContent(),
      layout: "gallery",
      slug: "gallery-showcase",
      published: true,
    },
    {
      siteId,
      userId,
      title: "Welcome to Tooty CMS",
      description: "A complete publishing platform for teams that need speed, clarity, and control.",
      image: WELCOME_POST_THUMBNAIL,
      content: markdownToStarterDoc(WELCOME_MARKETING_COPY),
      layout: "post",
      slug: "welcome-to-tooty",
      published: true,
    },
  ])
    .onConflictDoNothing({ target: [posts.slug, posts.siteId] });

  // Keep welcome post newest so default feeds show it first on initial load.
  await db
    .update(posts)
    .set({ createdAt: new Date(), updatedAt: new Date() })
    .where(and(eq(posts.siteId, siteId), eq(posts.slug, "welcome-to-tooty")));
}

export async function ensureMainSiteForCurrentUser() {
  const session = await getSession();
  if (!session?.user?.id) return;

  const existingPrimary = await db.query.sites.findFirst({
    where: (table, { and, eq }) => and(eq(table.userId, session.user.id), eq(table.isPrimary, true)),
    columns: { id: true, subdomain: true },
  });
  if (existingPrimary) {
    if (existingPrimary.subdomain !== PRIMARY_SUBDOMAIN) {
      await ensurePrimarySiteUsesMainSubdomain(existingPrimary.id);
    }
    const useRandomDefaultImages = await isRandomDefaultImagesEnabled();
    await ensureSeedSiteThumbnail(existingPrimary.id);
    await db.update(posts).set({ layout: "post" }).where(and(eq(posts.siteId, existingPrimary.id), isNull(posts.layout)));
    await ensureDefaultStarterPosts(existingPrimary.id, session.user.id, useRandomDefaultImages);
    await removeLegacyDocumentationPost(existingPrimary.id);
    return;
  }

  const existingAny = await db.query.sites.findFirst({
    where: (table, { eq }) => eq(table.userId, session.user.id),
    columns: { id: true, subdomain: true },
    orderBy: (table, { asc }) => [asc(table.createdAt)],
  });
  if (existingAny) {
    await db
      .update(sites)
      .set({ isPrimary: true })
      .where(eq(sites.id, existingAny.id));
    if (existingAny.subdomain !== PRIMARY_SUBDOMAIN) {
      await ensurePrimarySiteUsesMainSubdomain(existingAny.id);
    }
    const useRandomDefaultImages = await isRandomDefaultImagesEnabled();
    await ensureSeedSiteThumbnail(existingAny.id);
    await db.update(posts).set({ layout: "post" }).where(and(eq(posts.siteId, existingAny.id), isNull(posts.layout)));
    await ensureDefaultStarterPosts(existingAny.id, session.user.id, useRandomDefaultImages);
    await removeLegacyDocumentationPost(existingAny.id);
    return;
  }

  const useRandomDefaultImages = await isRandomDefaultImagesEnabled();

  const [site] = await db
    .insert(sites)
    .values({
      userId: session.user.id,
      name: "Main Site",
      description: "Your default Tooty site. Edit this anytime in settings.",
      subdomain: PRIMARY_SUBDOMAIN,
      image: DEFAULT_SITE_THUMBNAIL,
      isPrimary: true,
    })
    .returning({ id: sites.id });

  await ensureDefaultStarterPosts(site.id, session.user.id, useRandomDefaultImages);
  await removeLegacyDocumentationPost(site.id);
}
