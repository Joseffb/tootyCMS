import { getSession } from "@/lib/auth";
import db from "@/lib/db";
import { dataDomains, domainPosts, siteDataDomains, sites, users } from "@/lib/schema";
import { isRandomDefaultImagesEnabled } from "@/lib/cms-config";
import { and, eq, isNull } from "drizzle-orm";
import { listSiteIdsForUser, upsertSiteUserRole } from "@/lib/site-user-tables";
import { DEFAULT_CORE_DOMAIN_KEYS, ensureDefaultCoreDataDomains } from "@/lib/default-data-domains";
import { NETWORK_ADMIN_ROLE } from "@/lib/rbac";
import { readFile } from "node:fs/promises";
import path from "node:path";

const PRIMARY_SUBDOMAIN = "main";
const DEFAULT_SITE_THUMBNAIL = "/tooty/sprites/tooty-thumbs-up-cropped.png";
const WELCOME_POST_THUMBNAIL = "/tooty/sprites/tooty-laptop.png";
const STARTER_CONTENT_DIR = path.join(process.cwd(), "public", "docs");
const RECENT_MAIN_SITE_ENSURE_TTL_MS = 60_000;
const recentMainSiteEnsureByUser = new Map<string, number>();

const STARTER_FALLBACK = {
  welcome: `# Welcome to Tooty CMS

Thanks for giving Tooty a shot.

I built this CMS because I wanted a publishing system that stays clear under pressure: fast for editors, predictable for engineers, and practical for real teams.

## What You Have Right Now

- Domain-based content types with one consistent workflow.
- Theme and plugin contracts that keep core behavior stable.
- Site-scoped roles and capability-based access.
- Setup and schema lifecycle controls designed for safe upgrades.

## What The Tooty Community Can Be

- Builders sharing production-tested themes and plugins.
- Teams improving contracts, not patching around them.
- Contributors helping shape a CMS that values clarity over clutter.

## Start Here

1. Publish your first real post.
2. Set up your key pages and menu structure.
3. Pick a theme and make it yours.
4. Share what you build and what could be better.

Thanks again for using Tooty.

Fernain Betancourt`,
  about: `# About This Site

This site runs on Tooty CMS, a contract-first publishing platform for teams that need clear workflows and predictable runtime behavior.

## What This CMS Gives You

- Domain-based content types with consistent CRUD.
- Site-scoped roles and capability checks.
- Theme and plugin extension points with governance.
- Deterministic setup and schema lifecycle updates.

## Why This Matters

Tooty keeps operations practical: editors publish quickly, engineers keep control, and upgrades stay deterministic.`,
  terms: `# Terms of Service

Use this page as your legal baseline for site usage terms.

## Suggested Structure

- Acceptance of terms.
- Permitted and prohibited use.
- Intellectual property policy.
- Warranty disclaimers and liability limits.
- Contact and governing law details.

Replace this starter text with your legal counsel reviewed terms before launch.`,
  privacy: `# Privacy Policy

Use this page to describe how your site collects, uses, and retains data.

## Suggested Structure

- Data collected and purpose.
- Cookies and analytics disclosures.
- Third-party processors.
- Retention and deletion timelines.
- User rights and contact method.

Replace this starter text with policy language aligned to your legal and regional requirements.`,
} as const;

async function loadStarterMarkdown(
  key: keyof typeof STARTER_FALLBACK,
  filename: string,
) {
  try {
    const markdown = await readFile(path.join(STARTER_CONTENT_DIR, filename), "utf8");
    const trimmed = markdown.trim();
    if (trimmed.length) return trimmed;
  } catch {}
  return STARTER_FALLBACK[key];
}

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

async function getGlobalMainSite() {
  return db.query.sites.findFirst({
    where: eq(sites.subdomain, PRIMARY_SUBDOMAIN),
    columns: { id: true, userId: true },
  });
}

async function createPrimarySiteForUser(userId: string) {
  const tryInsert = async (subdomain: string, name: string) => {
    const created = await db
      .insert(sites)
      .values({
        userId,
        name,
        description: "Your default Tooty site. Edit this anytime in settings.",
        subdomain,
        image: DEFAULT_SITE_THUMBNAIL,
        isPrimary: true,
      })
      .onConflictDoNothing({ target: [sites.subdomain] })
      .returning({ id: sites.id });
    return created[0]?.id ?? "";
  };

  const globalMain = await getGlobalMainSite();
  if (!globalMain) {
    const mainId = await tryInsert(PRIMARY_SUBDOMAIN, "Main Site");
    if (mainId) return mainId;
    const existingMain = await getGlobalMainSite();
    if (existingMain?.id) return existingMain.id;
  }
  if (globalMain?.id) return globalMain.id;
  throw new Error("Main site bootstrap conflict: global main site could not be resolved.");
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
  const postDomain = await db.query.dataDomains.findFirst({
    where: eq(dataDomains.key, "post"),
    columns: { id: true },
  });
  if (!postDomain) return;
  await db.delete(domainPosts).where(and(eq(domainPosts.siteId, siteId), eq(domainPosts.dataDomainId, postDomain.id), eq(domainPosts.slug, "documentation")));
}

async function ensureDefaultSiteDataDomains(siteId: string) {
  const defaults = await ensureDefaultCoreDataDomains();
  for (const key of DEFAULT_CORE_DOMAIN_KEYS) {
    const domainId = defaults.get(key);
    if (!domainId) continue;
    await db
      .insert(siteDataDomains)
      .values({ siteId, dataDomainId: domainId, isActive: true })
      .onConflictDoUpdate({
        target: [siteDataDomains.siteId, siteDataDomains.dataDomainId],
        set: { isActive: true, updatedAt: new Date() },
      });
  }
}

async function getUserRoleForBootstrap(userId: string) {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { role: true },
  });
  if (!user) return null;
  return String(user.role || "").trim().toLowerCase();
}

async function ensureDefaultStarterPosts(siteId: string, userId: string, useRandomDefaultImages: boolean) {
  const [postDomain, pageDomain] = await Promise.all([
    db.query.dataDomains.findFirst({
      where: eq(dataDomains.key, "post"),
      columns: { id: true },
    }),
    db.query.dataDomains.findFirst({
      where: eq(dataDomains.key, "page"),
      columns: { id: true },
    }),
  ]);
  if (!postDomain || !pageDomain) return;
  await db
    .insert(siteDataDomains)
    .values([
      { siteId, dataDomainId: postDomain.id, isActive: true },
      { siteId, dataDomainId: pageDomain.id, isActive: true },
    ])
    .onConflictDoUpdate({
      target: [siteDataDomains.siteId, siteDataDomains.dataDomainId],
      set: { isActive: true, updatedAt: new Date() },
    });

  const [welcomeMarkdown, aboutMarkdown, termsMarkdown, privacyMarkdown] = await Promise.all([
    loadStarterMarkdown("welcome", "welcome.md"),
    loadStarterMarkdown("about", "about.md"),
    loadStarterMarkdown("terms", "terms-of-service.md"),
    loadStarterMarkdown("privacy", "privacy-policy.md"),
  ]);

  await db
    .insert(domainPosts)
    .values([
      {
        dataDomainId: postDomain.id,
        siteId,
        userId,
        title: "Welcome to Tooty CMS",
        description: "A complete publishing platform for teams that need speed, clarity, and control.",
        image: WELCOME_POST_THUMBNAIL,
        content: markdownToStarterDoc(welcomeMarkdown),
        layout: "post",
        slug: "welcome-to-tooty",
        published: true,
      },
      {
        dataDomainId: pageDomain.id,
        siteId,
        userId,
        title: "About This Site",
        description: "Core platform overview for this site.",
        ...(useRandomDefaultImages ? { image: "/tooty/sprites/tooty-notebook.png" } : {}),
        content: markdownToStarterDoc(aboutMarkdown),
        layout: "page",
        slug: "about-this-site",
        published: true,
      },
      {
        dataDomainId: pageDomain.id,
        siteId,
        userId,
        title: "Terms of Service",
        description: "Starter legal terms page for your site.",
        content: markdownToStarterDoc(termsMarkdown),
        layout: "page",
        slug: "terms-of-service",
        published: true,
      },
      {
        dataDomainId: pageDomain.id,
        siteId,
        userId,
        title: "Privacy Policy",
        description: "Starter privacy disclosure page for your site.",
        content: markdownToStarterDoc(privacyMarkdown),
        layout: "page",
        slug: "privacy-policy",
        published: true,
      },
    ])
    .onConflictDoNothing({ target: [domainPosts.slug, domainPosts.dataDomainId] });

  // Keep welcome post newest so default feeds show it first on initial load.
  await db
    .update(domainPosts)
    .set({ createdAt: new Date(), updatedAt: new Date() })
    .where(and(eq(domainPosts.siteId, siteId), eq(domainPosts.dataDomainId, postDomain.id), eq(domainPosts.slug, "welcome-to-tooty")));
}

export async function ensureMainSiteForCurrentUser(userIdFromSession?: string) {
  const userId = String(userIdFromSession || "").trim() || String((await getSession())?.user?.id || "").trim();
  if (!userId) return;
  const lastEnsuredAt = recentMainSiteEnsureByUser.get(userId) || 0;
  if (Date.now() - lastEnsuredAt < RECENT_MAIN_SITE_ENSURE_TTL_MS) return;
  const role = await getUserRoleForBootstrap(userId);
  if (!role) return;
  await ensureMainSiteForUser(userId, { seedStarterContent: false });
  recentMainSiteEnsureByUser.set(userId, Date.now());
}

export async function ensureMainSiteForUser(
  userId: string,
  options?: { seedStarterContent?: boolean },
) {
  if (!userId) return;
  const normalizedUserRole = await getUserRoleForBootstrap(userId);
  if (!normalizedUserRole) return;

  const defaultRole =
    normalizedUserRole === NETWORK_ADMIN_ROLE
      ? NETWORK_ADMIN_ROLE
      : normalizedUserRole === "administrator" || normalizedUserRole === "editor" || normalizedUserRole === "author"
        ? normalizedUserRole
        : "author";

  const seedStarterContent = options?.seedStarterContent === true;
  const globalMain = await getGlobalMainSite();
  const memberSiteIds = await listSiteIdsForUser(userId);

  const existingPrimary = memberSiteIds.length
    ? await db.query.sites.findFirst({
        where: (table, { and, eq, inArray }) => and(inArray(table.id, memberSiteIds), eq(table.isPrimary, true)),
        columns: { id: true, subdomain: true, name: true },
      })
    : null;
  const userPrimaryIsGlobalMain = Boolean(globalMain?.id && existingPrimary?.id && globalMain.id === existingPrimary.id);
  if (existingPrimary) {
    if (userPrimaryIsGlobalMain && existingPrimary.subdomain !== PRIMARY_SUBDOMAIN) {
      await ensurePrimarySiteUsesMainSubdomain(existingPrimary.id);
    }
    if (existingPrimary.subdomain !== PRIMARY_SUBDOMAIN && existingPrimary.name === "Main Site") {
      await db.update(sites).set({ name: "Site" }).where(eq(sites.id, existingPrimary.id));
    }
    await ensureSeedSiteThumbnail(existingPrimary.id);
    await ensureDefaultSiteDataDomains(existingPrimary.id);
    const postDomain = await db.query.dataDomains.findFirst({
      where: eq(dataDomains.key, "post"),
      columns: { id: true },
    });
    if (postDomain) {
      await db.update(domainPosts).set({ layout: "post" }).where(and(eq(domainPosts.siteId, existingPrimary.id), eq(domainPosts.dataDomainId, postDomain.id), isNull(domainPosts.layout)));
    }
    await upsertSiteUserRole(existingPrimary.id, userId, defaultRole);
    return;
  }

  const existingAny = memberSiteIds.length
    ? await db.query.sites.findFirst({
        where: (table, { inArray }) => inArray(table.id, memberSiteIds),
        columns: { id: true, subdomain: true, name: true },
        orderBy: (table, { asc }) => [asc(table.createdAt)],
      })
    : null;
  if (existingAny) {
    await db
      .update(sites)
      .set({ isPrimary: true })
      .where(eq(sites.id, existingAny.id));
    const userAnyIsGlobalMain = Boolean(globalMain?.id && existingAny.id === globalMain.id);
    if (userAnyIsGlobalMain && existingAny.subdomain !== PRIMARY_SUBDOMAIN) {
      await ensurePrimarySiteUsesMainSubdomain(existingAny.id);
    }
    if (existingAny.subdomain !== PRIMARY_SUBDOMAIN && existingAny.name === "Main Site") {
      await db.update(sites).set({ name: "Site" }).where(eq(sites.id, existingAny.id));
    }
    await ensureSeedSiteThumbnail(existingAny.id);
    await ensureDefaultSiteDataDomains(existingAny.id);
    const postDomain = await db.query.dataDomains.findFirst({
      where: eq(dataDomains.key, "post"),
      columns: { id: true },
    });
    if (postDomain) {
      await db.update(domainPosts).set({ layout: "post" }).where(and(eq(domainPosts.siteId, existingAny.id), eq(domainPosts.dataDomainId, postDomain.id), isNull(domainPosts.layout)));
    }
    await upsertSiteUserRole(existingAny.id, userId, defaultRole);
    return;
  }

  if (globalMain?.id) {
    await db
      .update(sites)
      .set({ isPrimary: true })
      .where(eq(sites.id, globalMain.id));
    await ensurePrimarySiteUsesMainSubdomain(globalMain.id);
    await ensureSeedSiteThumbnail(globalMain.id);
    await ensureDefaultSiteDataDomains(globalMain.id);
    const postDomain = await db.query.dataDomains.findFirst({
      where: eq(dataDomains.key, "post"),
      columns: { id: true },
    });
    if (postDomain) {
      await db
        .update(domainPosts)
        .set({ layout: "post" })
        .where(
          and(
            eq(domainPosts.siteId, globalMain.id),
            eq(domainPosts.dataDomainId, postDomain.id),
            isNull(domainPosts.layout),
          ),
        );
    }
    await upsertSiteUserRole(globalMain.id, userId, defaultRole);
    return;
  }

  const siteId = await createPrimarySiteForUser(userId);
  await upsertSiteUserRole(siteId, userId, defaultRole);
  await ensureDefaultSiteDataDomains(siteId);
  if (seedStarterContent) {
    const useRandomDefaultImages = await isRandomDefaultImagesEnabled();
    await ensureDefaultStarterPosts(siteId, userId, useRandomDefaultImages);
    await removeLegacyDocumentationPost(siteId);
  }
}
